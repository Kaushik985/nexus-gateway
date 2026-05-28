import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { providerApi } from '../../../../src/api/services/ai-gateway/providers';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('providerApi', () => {
  it('CRUD + health/models/analytics + test endpoints', () => {
    providerApi.list({ enabled: 'true' } as never);
    providerApi.get('p1');
    providerApi.create({} as never);
    providerApi.update('p1', {} as never);
    providerApi.delete('p1');
    providerApi.getHealth('p1');
    providerApi.getModels('p1');
    providerApi.addModel('p1', {} as never);
    providerApi.getAnalytics('p1');
    providerApi.testExisting('p1', 'c1');
    providerApi.testConnection({ name: 'n', adapterType: 'openai', baseUrl: 'u', apiKey: 'k' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/providers', { enabled: 'true' });
    expect(m.get).toHaveBeenCalledWith('/api/admin/providers/p1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/providers', {});
    expect(m.put).toHaveBeenCalledWith('/api/admin/providers/p1', {});
    expect(m.delete).toHaveBeenCalledWith('/api/admin/providers/p1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/providers/p1/health');
    expect(m.get).toHaveBeenCalledWith('/api/admin/providers/p1/models');
    expect(m.post).toHaveBeenCalledWith('/api/admin/providers/p1/models', {});
    expect(m.get).toHaveBeenCalledWith('/api/admin/analytics/provider/p1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/providers/p1/test', { credentialId: 'c1' });
    expect(m.post).toHaveBeenCalledWith('/api/admin/providers/test-connection', { name: 'n', adapterType: 'openai', baseUrl: 'u', apiKey: 'k' });
  });

  it('testExisting omits credentialId when none is given', () => {
    providerApi.testExisting('p1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/providers/p1/test', { credentialId: undefined });
  });
});

describe('providerApi — static template catalog (fetched from public JSON, no backend)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('getTemplates fetches index.json and unwraps the templates array', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ templates: [{ name: 'openai' }] }) });
    const out = await providerApi.getTemplates();
    expect(fetchMock).toHaveBeenCalledWith('/provider-templates/index.json', { cache: 'no-cache' });
    expect(out).toEqual({ data: [{ name: 'openai' }] });
  });

  it('getTemplates throws with the status when the index fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
    await expect(providerApi.getTemplates()).rejects.toThrow('load provider templates index: 404');
  });

  it('getTemplateDetail encodes the template name into the JSON path', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ name: 'azure openai' }) });
    const out = await providerApi.getTemplateDetail('azure openai');
    expect(fetchMock).toHaveBeenCalledWith('/provider-templates/azure%20openai.json', { cache: 'no-cache' });
    expect(out).toEqual({ name: 'azure openai' });
  });

  it('getTemplateDetail throws with the name + status when the detail fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    await expect(providerApi.getTemplateDetail('openai')).rejects.toThrow('load provider template openai: 500');
  });
});
