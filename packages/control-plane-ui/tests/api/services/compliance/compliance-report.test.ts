import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../../../../src/api/client';
import { complianceReportApi } from '../../../../src/api/services/compliance/compliance-report';
vi.mock('../../../../src/api/client', () => ({ api: { get: vi.fn().mockResolvedValue({}), post: vi.fn().mockResolvedValue({}), put: vi.fn().mockResolvedValue({}), patch: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue(undefined) } }));
const m = api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;
beforeEach(() => Object.values(m).forEach((f) => f.mockClear()));
describe('complianceReportApi', () => {
  it('get builds the startTime/endTime query string', () => {
    complianceReportApi.get('2026-01-01', '2026-02-01');
    expect(m.get).toHaveBeenCalledWith('/api/admin/compliance/report?startTime=2026-01-01&endTime=2026-02-01');
  });
});
