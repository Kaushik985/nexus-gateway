import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { patchOnboarding, downloadCACert, downloadMDMProfile, downloadPACFile } from '../../../../src/api/services/system/setup';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined), download: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('patchOnboarding', () => {
  it('PATCHes the proxy onboarding toggle (thingId encoded)', () => {
    patchOnboarding('a/b', true);
    expect(m.patch).toHaveBeenCalledWith('/api/admin/setup/proxy/a%2Fb/onboarding', { enabled: true });
  });
});

describe('setup downloads', () => {
  it('downloadCACert downloads the CA cert with the proxy-ca filename', () => {
    downloadCACert('t1');
    expect(m.download).toHaveBeenCalledWith('/api/admin/setup/proxy/t1/ca-cert', undefined, 'nexus-proxy-ca.crt');
  });

  it('downloadMDMProfile omits the organization param when absent, includes it when set', () => {
    downloadMDMProfile('t1');
    expect(m.download).toHaveBeenCalledWith('/api/admin/setup/proxy/t1/mdm-profile', undefined, 'nexus-proxy.mobileconfig');
    m.download.mockClear();
    downloadMDMProfile('t1', 'Acme');
    expect(m.download).toHaveBeenCalledWith('/api/admin/setup/proxy/t1/mdm-profile', { organization: 'Acme' }, 'nexus-proxy.mobileconfig');
  });

  it('downloadPACFile builds the proxy query, including failOpen only when provided', () => {
    downloadPACFile('t1', { proxyHost: 'h', proxyPort: '8080' });
    expect(m.download).toHaveBeenCalledWith('/api/admin/setup/proxy/t1/pac-file', { proxyHost: 'h', proxyPort: '8080' }, 'nexus-proxy.pac');
    m.download.mockClear();
    downloadPACFile('t1', { proxyHost: 'h', proxyPort: '8080', failOpen: false });
    expect(m.download).toHaveBeenCalledWith('/api/admin/setup/proxy/t1/pac-file', { proxyHost: 'h', proxyPort: '8080', failOpen: 'false' }, 'nexus-proxy.pac');
  });
});
