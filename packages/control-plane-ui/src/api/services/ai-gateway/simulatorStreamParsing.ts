import type { SimulatorCompletionUsage } from './simulatorTypes';

/** Normalize usage from chat bodies or SSE (snake_case OpenAI or camelCase gateway). */
export function normalizeSimulatorCompletionUsage(raw: unknown): SimulatorCompletionUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const pt = o.prompt_tokens ?? o.promptTokens;
  const ct = o.completion_tokens ?? o.completionTokens;
  const tt = o.total_tokens ?? o.totalTokens;
  const prompt_tokens = typeof pt === 'number' ? pt : undefined;
  const completion_tokens = typeof ct === 'number' ? ct : undefined;
  const total_tokens =
    typeof tt === 'number'
      ? tt
      : prompt_tokens !== undefined && completion_tokens !== undefined
        ? prompt_tokens + completion_tokens
        : undefined;
  if (
    prompt_tokens === undefined &&
    completion_tokens === undefined &&
    total_tokens === undefined
  ) {
    return undefined;
  }
  return { prompt_tokens, completion_tokens, total_tokens };
}

/** Text delta from OpenAI-style `chat.completion.chunk` frames. */
export function extractOpenAIChatDelta(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const p = parsed as { choices?: Array<{ delta?: { content?: string | null } }> };
  const c = p.choices?.[0]?.delta?.content;
  return typeof c === 'string' && c.length > 0 ? c : undefined;
}

/** Text delta from Anthropic Messages SSE `content_block_delta` + `text_delta` frames. */
export function extractAnthropicTextDelta(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const p = parsed as { type?: string; delta?: { type?: string; text?: string } };
  if (p.type !== 'content_block_delta' || !p.delta || typeof p.delta !== 'object') return undefined;
  if (p.delta.type !== 'text_delta') return undefined;
  const t = p.delta.text;
  return typeof t === 'string' && t.length > 0 ? t : undefined;
}

/** Text delta from Gemini `streamGenerateContent` SSE frames. Each
 * frame is a full GenerateContentResponse with one or more candidates
 * whose content.parts may carry incremental text. */
export function extractGeminiTextDelta(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const p = parsed as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = p.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
  return text.length > 0 ? text : undefined;
}

/** Text delta from OpenAI Responses-API SSE `response.output_text.delta` frames. */
export function extractResponsesAPITextDelta(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const p = parsed as { type?: string; delta?: string };
  if (p.type !== 'response.output_text.delta') return undefined;
  return typeof p.delta === 'string' && p.delta.length > 0 ? p.delta : undefined;
}

/** Reasoning summary delta from Responses-API SSE `response.reasoning_summary_text.delta`
 * (or the newer `response.reasoning_text.delta`) frames. Surfaced inline in
 * the simulator transcript with an `[reasoning] ` prefix so the operator
 * sees the model's chain-of-thought separately from the answer. */
export function extractResponsesAPIReasoningDelta(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const p = parsed as { type?: string; delta?: string };
  if (
    p.type !== 'response.reasoning_summary_text.delta' &&
    p.type !== 'response.reasoning_text.delta'
  ) {
    return undefined;
  }
  return typeof p.delta === 'string' && p.delta.length > 0 ? `[reasoning] ${p.delta}` : undefined;
}

/** Usage from Responses-API SSE `response.completed` event. Payload shape:
 *   { type:"response.completed", response:{ ..., usage:{ input_tokens, output_tokens,
 *     total_tokens, input_tokens_details:{cached_tokens},
 *     output_tokens_details:{reasoning_tokens} } } }
 */
export function responsesAPIUsageToSimulator(u: {
  input_tokens?: unknown;
  output_tokens?: unknown;
  total_tokens?: unknown;
}): SimulatorCompletionUsage | undefined {
  const prompt = typeof u.input_tokens === 'number' ? u.input_tokens : undefined;
  const completion = typeof u.output_tokens === 'number' ? u.output_tokens : undefined;
  const total = typeof u.total_tokens === 'number' ? u.total_tokens : undefined;
  if (prompt === undefined && completion === undefined && total === undefined) return undefined;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens:
      total ??
      (prompt !== undefined && completion !== undefined ? prompt + completion : undefined),
  };
}

export function anthropicUsageToSimulator(u: {
  input_tokens?: unknown;
  output_tokens?: unknown;
}): SimulatorCompletionUsage | undefined {
  const prompt = typeof u.input_tokens === 'number' ? u.input_tokens : undefined;
  const completion = typeof u.output_tokens === 'number' ? u.output_tokens : undefined;
  if (prompt === undefined && completion === undefined) return undefined;
  const total =
    prompt !== undefined && completion !== undefined ? prompt + completion : undefined;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

/** Gemini usageMetadata → simulator's prompt/completion/total triple. */
export function geminiUsageToSimulator(u: {
  promptTokenCount?: unknown;
  candidatesTokenCount?: unknown;
  totalTokenCount?: unknown;
}): SimulatorCompletionUsage | undefined {
  const prompt = typeof u.promptTokenCount === 'number' ? u.promptTokenCount : undefined;
  const completion = typeof u.candidatesTokenCount === 'number' ? u.candidatesTokenCount : undefined;
  const total = typeof u.totalTokenCount === 'number' ? u.totalTokenCount : undefined;
  if (prompt === undefined && completion === undefined && total === undefined) return undefined;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens:
      total ??
      (prompt !== undefined && completion !== undefined ? prompt + completion : undefined),
  };
}

/** Usage from OpenAI chunk.usage / Anthropic message_start|message_delta /
 * Gemini usageMetadata / Responses-API response.completed payloads. */
export function extractStreamUsage(parsed: unknown): SimulatorCompletionUsage | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const p = parsed as Record<string, unknown>;

  // Responses-API response.completed carries usage under response.usage.
  // Check before the OpenAI top-level usage path because the
  // chat-completions stream encoder also emits top-level usage on its
  // finish chunk — we want the Responses-shape envelope detected first.
  if (p.type === 'response.completed' && p.response && typeof p.response === 'object') {
    const usage = (p.response as { usage?: unknown }).usage;
    if (usage && typeof usage === 'object') {
      return responsesAPIUsageToSimulator(
        usage as { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown },
      );
    }
  }

  const openaiUsage = normalizeSimulatorCompletionUsage(p.usage);
  if (openaiUsage) return openaiUsage;

  if (p.type === 'message_start' && p.message && typeof p.message === 'object') {
    const usage = (p.message as { usage?: unknown }).usage;
    if (usage && typeof usage === 'object') {
      return anthropicUsageToSimulator(usage as { input_tokens?: unknown; output_tokens?: unknown });
    }
  }

  if (p.type === 'message_delta' && p.usage && typeof p.usage === 'object') {
    return anthropicUsageToSimulator(p.usage as { input_tokens?: unknown; output_tokens?: unknown });
  }

  if (p.usageMetadata && typeof p.usageMetadata === 'object') {
    return geminiUsageToSimulator(
      p.usageMetadata as {
        promptTokenCount?: unknown;
        candidatesTokenCount?: unknown;
        totalTokenCount?: unknown;
      },
    );
  }

  return undefined;
}
