import { describe, it, expect, vi, afterEach } from 'vitest';
import { aiGatewayClientSimulatorApi } from '../../../../src/api/services/ai-gateway/aiGatewayClientSimulator';
import { api } from '../../../../src/api/client';

afterEach(() => vi.restoreAllMocks());

const args = (format: string) => ({ baseUrl: 'https://up.example.com', vk: 'vk1', format, model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], params: {} } as never);
function mockForward(raw: unknown) { return vi.spyOn(api, 'post').mockResolvedValue(raw as never); }

describe('createChatCompletion → normalizeNonStreamResponse', () => {
  it('OpenAI canonical: passes through choices + normalizes usage', async () => {
    mockForward({ id: 'c1', choices: [{ index: 0, message: { role: 'assistant', content: 'hello' } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
    const r = await aiGatewayClientSimulatorApi.createChatCompletion(args('openai'));
    expect(r.choices?.[0]?.message?.content).toBe('hello');
    expect(r.usage).toBeTruthy();
  });

  it('Anthropic native: joins text blocks + maps input/output tokens', async () => {
    mockForward({ id: 'msg1', content: [{ type: 'text', text: 'hi ' }, { type: 'text', text: 'anthropic' }], usage: { input_tokens: 5, output_tokens: 3 } });
    const r = await aiGatewayClientSimulatorApi.createChatCompletion(args('anthropic'));
    expect(r.choices?.[0]?.message?.content).toBe('hi anthropic');
    expect(r.usage).toBeTruthy();
  });

  it('Responses API: message output_text', async () => {
    mockForward({ object: 'response', id: 'resp1', output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi resp' }] }], usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } });
    const r = await aiGatewayClientSimulatorApi.createChatCompletion(args('openai-responses'));
    expect(r.choices?.[0]?.message?.content).toBe('hi resp');
  });

  it('Responses API: reasoning summary prepended before the answer', async () => {
    mockForward({ object: 'response', output: [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }] },
      { type: 'message', content: [{ type: 'output_text', text: 'answer' }] },
    ] });
    const r = await aiGatewayClientSimulatorApi.createChatCompletion(args('openai-responses'));
    expect(r.choices?.[0]?.message?.content).toBe('[reasoning] thinking\n\nanswer');
  });

  it('Gemini native: candidates.content.parts text + usageMetadata', async () => {
    mockForward({ candidates: [{ content: { parts: [{ text: 'hi gemini' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 } });
    const r = await aiGatewayClientSimulatorApi.createChatCompletion(args('gemini'));
    expect(r.choices?.[0]?.message?.content).toBe('hi gemini');
    expect(r.usage).toBeTruthy();
  });

  it('unrecognised shape: a labelled fallback assistant message', async () => {
    mockForward({ weird: true });
    const r = await aiGatewayClientSimulatorApi.createChatCompletion(args('gemini'));
    expect(r.choices?.[0]?.message?.content).toContain('no recognised content for format=gemini');
  });

  it('non-object response → empty envelope', async () => {
    mockForward(null);
    const r = await aiGatewayClientSimulatorApi.createChatCompletion(args('openai'));
    expect(r.choices).toBeUndefined();
  });
});
