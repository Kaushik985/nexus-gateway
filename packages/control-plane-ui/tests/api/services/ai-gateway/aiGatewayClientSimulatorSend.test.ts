/**
 * aiGatewayClientSimulatorApi send paths — listModels / getUsage /
 * createChatCompletion all POST to the forward relay with a built payload
 * (targetUrl/path/method/vk/body); createChatCompletion normalizes the upstream
 * envelope to OpenAI shape. (The pure builders, path and validate helpers plus
 * the normalize adapters are covered in the sibling test files; the SSE stream
 * path is the documented hard residual.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { aiGatewayClientSimulatorApi } from '../../../../src/api/services/ai-gateway/aiGatewayClientSimulator';

vi.mock('../../../../src/api/client', () => ({ api: { post: vi.fn() } }));
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const FORWARD = '/api/admin/ai-gateway-simulator/forward';
beforeEach(() => post.mockReset().mockResolvedValue({}));

describe('aiGatewayClientSimulatorApi', () => {
  it('listModels forwards a GET /v1/models with the trimmed VK', async () => {
    await aiGatewayClientSimulatorApi.listModels('https://api.openai.com', '  nvk_x  ');
    expect(post).toHaveBeenCalledWith(FORWARD, expect.objectContaining({ path: '/v1/models', method: 'GET', vk: 'nvk_x' }));
  });

  it('getUsage forwards a GET /v1/usage', async () => {
    await aiGatewayClientSimulatorApi.getUsage('https://api.openai.com', 'nvk_x');
    expect(post).toHaveBeenCalledWith(FORWARD, expect.objectContaining({ path: '/v1/usage', method: 'GET' }));
  });

  it('createChatCompletion (openai) POSTs /v1/chat/completions and normalizes the reply', async () => {
    post.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'hi there' } }], usage: { total_tokens: 5 } });
    const res = await aiGatewayClientSimulatorApi.createChatCompletion({
      baseUrl: 'https://api.openai.com', vk: 'nvk_x', format: 'openai', model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }], params: {} as never,
    });
    expect(post).toHaveBeenCalledWith(FORWARD, expect.objectContaining({
      path: '/v1/chat/completions', method: 'POST',
      body: expect.objectContaining({ model: 'gpt-4o' }),
    }));
    expect(res.choices?.[0]?.message?.content).toBe('hi there');
  });
});
