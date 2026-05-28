/**
 * aiGatewayClientSimulatorApi.createChatCompletionStream — the SSE streaming
 * send path. Mocks global fetch with a streamed Response (the "mock the
 * resource, don't skip" case: a real chart/stream can't run otherwise) and
 * asserts the SSE frame parser fires onDelta per chunk + onDone on the [DONE]
 * sentinel. Also covers the !res.ok → parseError throw.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aiGatewayClientSimulatorApi } from '../../../../src/api/services/ai-gateway/aiGatewayClientSimulator';

const enc = (s: string) => new TextEncoder().encode(s);
function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc(f));
      controller.close();
    },
  });
}
const args = { baseUrl: 'https://api.openai.com', vk: 'nvk_x', format: 'openai' as const, model: 'gpt-4o', messages: [{ role: 'user' as const, content: 'hi' }], params: {} as never };

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('createChatCompletionStream', () => {
  it('parses OpenAI SSE deltas and signals completion on [DONE]', async () => {
    const body = sseStream([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body }));
    const onDelta = vi.fn(), onDone = vi.fn(), onUsage = vi.fn();
    await aiGatewayClientSimulatorApi.createChatCompletionStream(args, { onDelta, onDone, onUsage });
    expect(onDelta).toHaveBeenCalledWith('Hel');
    expect(onDelta).toHaveBeenCalledWith('lo');
    expect(onUsage).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('treats a clean EOF (no [DONE], e.g. Anthropic/Gemini) as completion', async () => {
    const body = sseStream(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body }));
    const onDelta = vi.fn(), onDone = vi.fn();
    await aiGatewayClientSimulatorApi.createChatCompletionStream(args, { onDelta, onDone });
    expect(onDelta).toHaveBeenCalledWith('x');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('throws a parsed error when the forward response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429,
      json: async () => ({ error: { message: 'rate limited' } }),
      text: async () => 'rate limited',
    }));
    await expect(
      aiGatewayClientSimulatorApi.createChatCompletionStream(args, { onDelta: vi.fn(), onDone: vi.fn() }),
    ).rejects.toThrow();
  });
});
