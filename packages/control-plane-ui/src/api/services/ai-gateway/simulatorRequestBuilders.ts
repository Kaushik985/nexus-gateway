import type { BuildArgs, RequestFormat, RequestParams } from './simulatorTypes';

// --- Per-format request building ----------------------------------------

/** Strip `undefined`-valued keys so they never reach the wire body. */
function pruneUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/** OpenAI chat.completions wire body. `system` is prepended as a
 * system-role message because OpenAI doesn't take a top-level system
 * field. `stop` (UI string) is wrapped to a single-element array. */
export function buildOpenAIBody({ model, messages, params, stream }: BuildArgs): Record<string, unknown> {
  const finalMessages =
    typeof params.system === 'string' && params.system.length > 0
      ? [{ role: 'system' as const, content: params.system }, ...messages]
      : messages;
  return pruneUndefined({
    model,
    messages: finalMessages,
    stream,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    top_p: params.top_p,
    presence_penalty: params.presence_penalty,
    frequency_penalty: params.frequency_penalty,
    seed: params.seed,
    stop: typeof params.stop === 'string' && params.stop.length > 0 ? [params.stop] : undefined,
  });
}

/** Anthropic Messages wire body. Anthropic requires `max_tokens` at the
 * top level — callers must validate this before invoking the build (the
 * simulator UI surfaces it as a hard gate on Send). `system` is a
 * top-level field, NOT a message. */
export function buildAnthropicBody({ model, messages, params, stream }: BuildArgs): Record<string, unknown> {
  return pruneUndefined({
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream,
    max_tokens: params.max_tokens,
    temperature: params.temperature,
    top_p: params.top_p,
    system: typeof params.system === 'string' && params.system.length > 0 ? params.system : undefined,
    stop_sequences:
      typeof params.stop === 'string' && params.stop.length > 0 ? [params.stop] : undefined,
  });
}

/** Gemini generateContent wire body. messages → contents array, role
 * `assistant` becomes `model`. system → top-level systemInstruction.
 * Tunables go under `generationConfig`. The model name does NOT appear
 * in the body — Gemini puts it in the URL path. */
export function buildGeminiBody({ messages, params, stream }: BuildArgs): Record<string, unknown> {
  const generationConfig = pruneUndefined({
    temperature: params.temperature,
    maxOutputTokens: params.max_tokens,
    topP: params.top_p,
    seed: params.seed,
    stopSequences:
      typeof params.stop === 'string' && params.stop.length > 0 ? [params.stop] : undefined,
  });
  return pruneUndefined({
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }],
    })),
    systemInstruction:
      typeof params.system === 'string' && params.system.length > 0
        ? { parts: [{ text: params.system }] }
        : undefined,
    generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
    // Gemini doesn't carry `stream` in the body — the stream-vs-not
    // distinction is encoded in the path (:streamGenerateContent vs
    // :generateContent). Field intentionally omitted; `stream` arg
    // referenced here so eslint no-unused-vars stays happy.
    ...(stream ? {} : {}),
  });
}

/** OpenAI Responses-API wire body. `input` is either a string shorthand
 * (single user message) or an array of input items (multi-turn).
 * `instructions` carries system-level guidance (maps from the simulator's
 * `system` param). `max_tokens` maps to `max_output_tokens`.
 * `presence_penalty` / `frequency_penalty` / `seed` are not accepted by
 * this surface and are dropped silently. */
export function buildOpenAIResponsesBody({ model, messages, params, stream }: BuildArgs): Record<string, unknown> {
  // Convert messages array into Responses input items. A single user
  // message uses the string-shorthand form; everything else fans out
  // into the full input-item array so previous turns + system prompt
  // round-trip cleanly.
  let input: unknown;
  if (messages.length === 1 && messages[0]?.role === 'user' && typeof messages[0].content === 'string') {
    input = messages[0].content;
  } else {
    input = messages.map((m) => ({
      role: m.role,
      content: [{ type: 'input_text', text: m.content }],
    }));
  }
  return pruneUndefined({
    model,
    input,
    instructions:
      typeof params.system === 'string' && params.system.length > 0 ? params.system : undefined,
    stream,
    temperature: params.temperature,
    top_p: params.top_p,
    max_output_tokens: params.max_tokens,
  });
}

/** Path the simulator should target for a given (format, model, stream)
 * triple. */
export function pathForRequest(format: RequestFormat, _model: string, stream: boolean): string {
  switch (format) {
    case 'openai':
      return '/v1/chat/completions';
    case 'anthropic':
      return '/v1/messages';
    case 'gemini':
      return `/v1beta/models/${encodeURIComponent(_model)}:${stream ? 'streamGenerateContent' : 'generateContent'}`;
    case 'openai-responses':
      return '/v1/responses';
  }
}

export function buildBody(format: RequestFormat, args: BuildArgs): Record<string, unknown> {
  let base: Record<string, unknown>;
  switch (format) {
    case 'openai':
      base = buildOpenAIBody(args);
      break;
    case 'anthropic':
      base = buildAnthropicBody(args);
      break;
    case 'gemini':
      base = buildGeminiBody(args);
      break;
    case 'openai-responses':
      base = buildOpenAIResponsesBody(args);
      break;
  }
  // Custom params merge in at the root, AFTER the standard build, so an
  // operator can override a standard field (e.g. force a different
  // model name shape) and reach provider-specific extensions the
  // simulator UI doesn't surface as first-class checkboxes.
  if (args.params.customParams) {
    for (const [k, v] of Object.entries(args.params.customParams)) {
      if (v !== undefined) base[k] = v;
    }
  }
  return base;
}

/** Per-format pre-flight validation. Returns null on OK, a
 * human-readable error string otherwise. Anthropic Messages requires
 * max_tokens at the top level — sending without it gets a 400 from the
 * API and an unhelpful "validation_error" in the simulator transcript;
 * surfacing the hint here keeps the operator from chasing a non-bug. */
export function validateRequest(format: RequestFormat, params: RequestParams): string | null {
  if (format === 'anthropic' && (params.max_tokens === undefined || params.max_tokens <= 0)) {
    return 'Anthropic Messages requires max_tokens — enable it in Params.';
  }
  return null;
}
