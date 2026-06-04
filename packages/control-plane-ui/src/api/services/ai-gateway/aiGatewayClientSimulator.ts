import { api } from '../../client';
import { getAccessToken } from '../../../auth/tokens/tokenStore';
import type {
  RequestFormat,
  RequestParams,
  SimulatorChatMessage,
  SimulatorCompletionUsage,
} from './simulatorTypes';
import { buildBody, pathForRequest } from './simulatorRequestBuilders';
import {
  anthropicUsageToSimulator,
  extractAnthropicTextDelta,
  extractGeminiTextDelta,
  extractOpenAIChatDelta,
  extractResponsesAPIReasoningDelta,
  extractResponsesAPITextDelta,
  extractStreamUsage,
  geminiUsageToSimulator,
  normalizeSimulatorCompletionUsage,
  responsesAPIUsageToSimulator,
} from './simulatorStreamParsing';

// Re-export the public surface moved into sibling modules so external
// importers of aiGatewayClientSimulator.ts are unaffected.
export type {
  RequestFormat,
  RequestParams,
  SimulatorChatMessage,
  SimulatorCompletionUsage,
} from './simulatorTypes';
export {
  buildOpenAIBody,
  buildAnthropicBody,
  buildGeminiBody,
  buildOpenAIResponsesBody,
  pathForRequest,
  validateRequest,
} from './simulatorRequestBuilders';

export interface SimulatorModelObject {
  id: string;
  /** Human-readable label from the gateway; falls back to `id` in the UI when absent. */
  name?: string;
  object?: string;
  created?: number;
  owned_by?: string;
  owner_display_name?: string;
}

export interface SimulatorModelListResponse {
  object?: string;
  data: SimulatorModelObject[];
}

export interface SimulatorChatResponse {
  id?: string;
  choices?: Array<{
    index?: number;
    message?: SimulatorChatMessage;
    finish_reason?: string | null;
  }>;
  usage?: SimulatorCompletionUsage;
}

export interface SimulatorUsageSummaryResponse {
  virtualKeyId?: string;
  period?: string;
  periodType?: string;
  usage?: {
    totalRequests?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
}

export interface SimulatorStreamCallbacks {
  onDelta: (delta: string) => void;
  onDone: () => void;
  onUsage?: (usage: SimulatorCompletionUsage) => void;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

async function parseError(res: Response): Promise<Error> {
  const fallback = `Request failed (${res.status})`;
  try {
    const json = (await res.json()) as { error?: { message?: string } | string };
    if (typeof json?.error === 'string') return new Error(json.error);
    if (json?.error && typeof json.error === 'object' && typeof json.error.message === 'string') {
      return new Error(json.error.message);
    }
  } catch {
    // Ignore body parse errors and use fallback text.
  }
  return new Error(fallback);
}

// FORWARD_ENDPOINT routes the simulator's calls through the Control
// Plane backend so the browser only ever talks to the same HTTPS origin
// as the rest of the admin UI. Hits a same-origin URL → no
// mixed-content blocker even when the target ai-gateway is HTTP.
//
// The CP handler validates the admin session (Bearer access token from
// the project tokenStore — same auth scheme every other admin API uses),
// enforces an SSRF allowlist on the target path + scheme, attaches the
// gateway VK as the upstream Bearer auth, and streams the response back
// chunk-by-chunk so SSE responses keep their real-time delivery.
const FORWARD_ENDPOINT = '/api/admin/ai-gateway-simulator/forward';

interface ForwardRequest {
  targetUrl: string;
  path: string;
  method: 'GET' | 'POST';
  vk: string;
  body?: unknown;
}

function buildForwardPayload(req: ForwardRequest) {
  return {
    targetUrl: normalizeBaseUrl(req.targetUrl),
    path: req.path,
    method: req.method,
    vk: req.vk.trim(),
    body: req.body,
  };
}

// rawForwardFetch is the streaming-friendly path: project's `api.post`
// wrapper returns parsed JSON, but the SSE stream needs the raw Response
// reader. Replicates the wrapper's auth: read the access token from the
// shared tokenStore and stamp Authorization: Bearer. No refresh-on-401
// retry on this path — a long stream with an expired token simply
// surfaces the 401, which is acceptable for an admin debugging tool.
async function rawForwardFetch(req: ForwardRequest, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(FORWARD_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildForwardPayload(req)),
    signal,
  });
}

export interface SendChatArgs {
  baseUrl: string;
  vk: string;
  format: RequestFormat;
  model: string;
  messages: SimulatorChatMessage[];
  params: RequestParams;
}

/** Non-stream chat completion. The shape of the returned envelope is
 * normalized to OpenAI's `choices[0].message.content` regardless of
 * upstream format so the timeline rendering stays uniform. */
async function createChatCompletion(args: SendChatArgs): Promise<SimulatorChatResponse> {
  const path = pathForRequest(args.format, args.model, false);
  const body = buildBody(args.format, {
    model: args.model,
    messages: args.messages,
    params: args.params,
    stream: false,
  });
  const json = await api.post<unknown>(
    FORWARD_ENDPOINT,
    buildForwardPayload({
      targetUrl: args.baseUrl,
      path,
      method: 'POST',
      vk: args.vk,
      body,
    }),
  );
  return normalizeNonStreamResponse(args.format, json);
}

/** Per-format response → OpenAI-shape `SimulatorChatResponse` adapter
 * so the timeline doesn't need to know which format it's rendering.
 *
 * Defensive shape detection: OpenAI canonical shape (`choices[].message`)
 * is tried FIRST regardless of declared format because the gateway
 * frequently normalizes responses to canonical OpenAI even on
 * non-OpenAI ingress paths (the canonicalbridge hub design). Falling
 * back to format-specific shapes only when the canonical shape is
 * absent keeps the timeline working whether or not a given path
 * round-trips through the response-side bridge. */
function normalizeNonStreamResponse(format: RequestFormat, raw: unknown): SimulatorChatResponse {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;

  // Try OpenAI canonical shape first — it covers OpenAI ingress AND any
  // cross-format request the gateway has hub-normalized.
  const choices = r.choices as
    | Array<{ index?: number; message?: { role?: string; content?: string }; finish_reason?: string | null }>
    | undefined;
  if (
    Array.isArray(choices) &&
    choices.length > 0 &&
    typeof choices[0]?.message?.content === 'string'
  ) {
    const out = r as SimulatorChatResponse;
    const u = normalizeSimulatorCompletionUsage(out.usage);
    if (u) out.usage = u;
    return out;
  }

  // Anthropic native shape: `content` is an array of typed blocks.
  if (Array.isArray(r.content)) {
    const blocks = r.content as Array<{ type?: string; text?: string }>;
    const text = blocks
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
    if (text.length > 0) {
      const u = anthropicUsageToSimulator(
        (r.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined) ?? {},
      );
      return {
        id: typeof r.id === 'string' ? r.id : undefined,
        choices: [{ index: 0, message: { role: 'assistant', content: text } }],
        usage: u,
      };
    }
  }

  // OpenAI Responses-API native shape: output[] is an array of typed
  // items — `message` carries content[].text; `reasoning` carries
  // summary[].text; others pass through untyped. Reasoning is prepended
  // so the operator sees chain-of-thought before the answer.
  if (typeof r.object === 'string' && r.object === 'response' && Array.isArray(r.output)) {
    const output = r.output as Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
      summary?: Array<{ type?: string; text?: string }>;
    }>;
    const reasoningParts: string[] = [];
    const textParts: string[] = [];
    for (const item of output) {
      if (item?.type === 'reasoning' && Array.isArray(item.summary)) {
        for (const s of item.summary) {
          if (s?.type === 'summary_text' && typeof s.text === 'string') {
            reasoningParts.push(s.text);
          }
        }
      } else if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === 'output_text' && typeof c.text === 'string') {
            textParts.push(c.text);
          }
        }
      }
    }
    const content = [
      reasoningParts.length > 0 ? `[reasoning] ${reasoningParts.join('')}\n\n` : '',
      textParts.join(''),
    ].join('');
    if (content.length > 0) {
      const u = responsesAPIUsageToSimulator(
        (r.usage as { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown } | undefined) ?? {},
      );
      return {
        id: typeof r.id === 'string' ? r.id : undefined,
        choices: [{ index: 0, message: { role: 'assistant', content } }],
        usage: u,
      };
    }
  }

  // Gemini native shape: candidates[].content.parts[].text.
  if (Array.isArray(r.candidates)) {
    const candidates = r.candidates as Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    const text = (candidates[0]?.content?.parts ?? [])
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('');
    if (text.length > 0) {
      const u = geminiUsageToSimulator(
        (r.usageMetadata as {
          promptTokenCount?: unknown;
          candidatesTokenCount?: unknown;
          totalTokenCount?: unknown;
        } | undefined) ?? {},
      );
      return {
        choices: [{ index: 0, message: { role: 'assistant', content: text } }],
        usage: u,
      };
    }
  }

  // Last-resort: caller picked a format but the body matched none of the
  // recognised shapes. Surface an empty assistant message so the UI
  // shows something rather than silently dropping the response — the
  // operator can inspect the network panel to see the raw payload.
  // `format` is referenced in the stub message so a future shape
  // mismatch is at least labelled with what was expected.
  return {
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: `(no recognised content for format=${format})`,
        },
      },
    ],
  };
}

/** Streaming chat completion. The simulator timeline only needs text
 * deltas + a final usage block, so we collapse OpenAI / Anthropic /
 * Gemini SSE shapes into a single delta-and-usage callback contract. */
async function createChatCompletionStream(
  args: SendChatArgs,
  callbacks: SimulatorStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const path = pathForRequest(args.format, args.model, true);
  const body = buildBody(args.format, {
    model: args.model,
    messages: args.messages,
    params: args.params,
    stream: true,
  });
  const res = await rawForwardFetch(
    {
      targetUrl: args.baseUrl,
      path,
      method: 'POST',
      vk: args.vk,
      body,
    },
    signal,
  );
  if (!res.ok) throw await parseError(res);
  if (!res.body) throw new Error('SSE stream body is empty');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneNotified = false;

  const handleEventPayload = (payload: string) => {
    const data = payload.trim();
    if (!data) return;
    if (data === '[DONE]') {
      doneNotified = true;
      callbacks.onDone();
      return;
    }
    try {
      const parsed: unknown = JSON.parse(data);
      const delta =
        extractOpenAIChatDelta(parsed) ??
        extractAnthropicTextDelta(parsed) ??
        extractGeminiTextDelta(parsed) ??
        extractResponsesAPITextDelta(parsed) ??
        extractResponsesAPIReasoningDelta(parsed);
      if (delta) callbacks.onDelta(delta);
      const usage = extractStreamUsage(parsed);
      if (usage && callbacks.onUsage) {
        const u = normalizeSimulatorCompletionUsage(usage) ?? usage;
        callbacks.onUsage(u);
      }
    } catch {
      // Ignore non-JSON frames to keep stream resilient.
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const evt of events) {
      const lines = evt.split('\n');
      const chunks: string[] = [];
      for (const line of lines) {
        if (line.startsWith('data:')) chunks.push(line.slice(5).trimStart());
      }
      if (chunks.length > 0) {
        handleEventPayload(chunks.join('\n'));
      }
    }
  }

  if (!doneNotified) {
    const tail = buffer.trim();
    if (tail.includes('data: [DONE]')) {
      callbacks.onDone();
    } else if (!doneNotified) {
      // Anthropic + Gemini terminate the stream with an EOF instead of
      // a `data: [DONE]` sentinel; treat a clean reader EOF as
      // completion rather than an error.
      callbacks.onDone();
    }
  }
}

export const aiGatewayClientSimulatorApi = {
  async listModels(baseUrl: string, vk: string): Promise<SimulatorModelListResponse> {
    return api.post<SimulatorModelListResponse>(
      FORWARD_ENDPOINT,
      buildForwardPayload({ targetUrl: baseUrl, path: '/v1/models', method: 'GET', vk }),
    );
  },

  createChatCompletion,
  createChatCompletionStream,

  async getUsage(baseUrl: string, vk: string): Promise<SimulatorUsageSummaryResponse> {
    return api.post<SimulatorUsageSummaryResponse>(
      FORWARD_ENDPOINT,
      buildForwardPayload({ targetUrl: baseUrl, path: '/v1/usage', method: 'GET', vk }),
    );
  },
};
