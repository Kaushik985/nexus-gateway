import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import { QuotaPolicyListPage } from '@/pages/ai-gateway/quota-policies/QuotaPolicyList';

const policies = [
  { id: 'q1', name: 'Org Budget', scope: 'organization', organizationId: 'o1', periodType: 'monthly', enforcementMode: 'hard', costLimitUsd: 100, tokenLimit: null, alertThresholds: [80], priority: 1, enabled: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: 'q2', name: 'VK Cap', scope: 'vk', periodType: 'daily', enforcementMode: 'soft', costLimitUsd: 5, alertThresholds: [], priority: 0, enabled: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];
vi.mock('@/hooks/useApi', () => ({ useApi: () => ({ data: { data: policies, total: 2 }, loading: false, error: null, refetch: vi.fn() }) }));
vi.mock('@/hooks/useMutation', () => ({ useMutation: () => ({ mutate: vi.fn(), loading: false }) }));

describe('QuotaPolicyListPage (data-driven)', () => {
  it('renders quota-policy rows in the table', () => {
    renderWithRouter(<QuotaPolicyListPage />);
    expect(screen.getByText('Org Budget')).toBeInTheDocument();
    expect(screen.getByText('VK Cap')).toBeInTheDocument();
  });
});
