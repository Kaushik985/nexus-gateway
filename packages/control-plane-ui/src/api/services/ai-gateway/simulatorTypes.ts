export interface SimulatorChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Wire-format the simulator UI lets the operator pick from. Each value
 * controls the endpoint path AND the request body shape — e.g. picking
 * "anthropic" sends to /v1/messages with Anthropic's required-max_tokens
 * top-level shape rather than chat.completions.
 *
 * "openai-responses" targets POST /v1/responses with the OpenAI
 * Responses-API shape (`input` instead of `messages`, `instructions` for
 * system-style guidance, `max_output_tokens` rename, `reasoning.effort`,
 * etc.) and parses the response.* SSE event stream.
 */
export type RequestFormat = 'openai' | 'anthropic' | 'gemini' | 'openai-responses';

/** Optional per-request knobs. A field that is `undefined` is omitted
 * from the wire body — the whole point of the toolbar's per-param
 * checkboxes is to avoid sending parameters a model rejects (e.g.
 * Claude Opus 4.7 rejecting `temperature`). */
export interface RequestParams {
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  stop?: string;
  /** System prompt prepended per-format: as a `system` message
   * (OpenAI), top-level `system` field (Anthropic), or
   * `systemInstruction` (Gemini). */
  system?: string;
  /** Operator-supplied extra fields, merged into the wire body at the
   * root after the standard params. Used to reach provider-specific
   * knobs the simulator UI doesn't model (e.g. Anthropic
   * `thinking: {type:"enabled", budget_tokens:2000}`, Gemini
   * `safetySettings`, OpenAI `response_format`). Values that override
   * a standard param win. Each value should already be JSON-parsed by
   * the caller — strings stay strings, objects/arrays stay structured. */
  customParams?: Record<string, unknown>;
}

export interface SimulatorCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface BuildArgs {
  model: string;
  messages: SimulatorChatMessage[];
  params: RequestParams;
  stream: boolean;
}
