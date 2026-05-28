import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, ApiError } from '../../../../src/api/client';
import { rulePacksApi } from '../../../../src/api/services/compliance/rulepacks';
import { getAccessToken } from '../../../../src/auth/tokens/tokenStore';

// Keep the real ApiError (postYaml throws `new ApiError(...)`); only stub `api`.
vi.mock('../../../../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../../../../src/api/client')>()),
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../../../src/auth/tokens/tokenStore', () => ({ getAccessToken: vi.fn() }));

const m = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
const tok = getAccessToken as unknown as ReturnType<typeof vi.fn>;

describe('rulePacksApi — JSON endpoints', () => {
  beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));

  it('pack CRUD routes to /api/admin/rule-packs', () => {
    rulePacksApi.list();
    rulePacksApi.get('p1');
    rulePacksApi.create({ name: 'P', version: '1', maintainer: 'me', rules: [] } as never);
    rulePacksApi.update('p1', { description: 'd' });
    rulePacksApi.delete('p1');
    expect(m.get).toHaveBeenCalledWith('/api/admin/rule-packs');
    expect(m.get).toHaveBeenCalledWith('/api/admin/rule-packs/p1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/rule-packs', { name: 'P', version: '1', maintainer: 'me', rules: [] });
    expect(m.patch).toHaveBeenCalledWith('/api/admin/rule-packs/p1', { description: 'd' });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/rule-packs/p1');
  });

  it('dry-run wraps the content in a {content} body', () => {
    rulePacksApi.dryRun('p1', 'some text');
    expect(m.post).toHaveBeenCalledWith('/api/admin/rule-packs/p1/dry-run', { content: 'some text' });
  });

  it('install + per-hook list nest under the hook id', () => {
    rulePacksApi.install('h1', { packId: 'p1', pinVersion: '1', enabled: true });
    rulePacksApi.listInstallsForHook('h1');
    expect(m.post).toHaveBeenCalledWith('/api/admin/hooks/h1/rule-packs', { packId: 'p1', pinVersion: '1', enabled: true });
    expect(m.get).toHaveBeenCalledWith('/api/admin/hooks/h1/rule-packs');
  });

  it('install lifecycle: patch enabled / uninstall / overrides / effective-rules', () => {
    rulePacksApi.patchInstall('in1', false);
    rulePacksApi.uninstall('in1');
    rulePacksApi.upsertOverrides('in1', [{ ruleLocalId: 'r1', disabled: true }]);
    rulePacksApi.effectiveRules('in1');
    expect(m.patch).toHaveBeenCalledWith('/api/admin/rule-pack-installs/in1', { enabled: false });
    expect(m.delete).toHaveBeenCalledWith('/api/admin/rule-pack-installs/in1');
    expect(m.patch).toHaveBeenCalledWith('/api/admin/rule-pack-installs/in1/overrides', { overrides: [{ ruleLocalId: 'r1', disabled: true }] });
    expect(m.get).toHaveBeenCalledWith('/api/admin/rule-pack-installs/in1/effective-rules');
  });
});

describe('rulePacksApi — YAML endpoints (preview/import via fetch)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    tok.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preview POSTs text/x-yaml with a Bearer header when a token exists', async () => {
    tok.mockReturnValue('TKN');
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ matches: [] }) });
    const out = await rulePacksApi.preview('rules: []');
    expect(out).toEqual({ matches: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/admin/rule-packs/preview');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('rules: []');
    expect(init.headers['Content-Type']).toBe('text/x-yaml');
    expect(init.headers.Authorization).toBe('Bearer TKN');
  });

  it('import omits the Authorization header when there is no token', async () => {
    tok.mockReturnValue(null);
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ imported: 1 }) });
    await rulePacksApi.import('rules: []');
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/admin/rule-packs/import');
  });

  it('throws an ApiError carrying the server error message on a non-ok response', async () => {
    tok.mockReturnValue('TKN');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable',
      json: () => Promise.resolve({ error: 'bad yaml' }),
    });
    await expect(rulePacksApi.preview('x')).rejects.toMatchObject({ status: 422, message: 'bad yaml' });
  });

  it('falls back to statusText when the error body is not JSON', async () => {
    tok.mockReturnValue('TKN');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: () => Promise.reject(new Error('not json')),
    });
    const err = await rulePacksApi.import('x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Server Error');
  });
});
