import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ProviderUsageTab } from '@/pages/ai-gateway/providers/detail/ProviderUsageTab';

vi.mock('@/theme/useTheme', () => ({ useTheme: () => ({ resolvedMode: 'light' }) }));

const analyticsData = {
  summary: { totalRequests: 1000, errorRate: 0.02, errorCount: 20, avgLatencyMs: 50, totalTokens: 5000, totalEstimatedCostUsd: 1.5, cacheHitRate: 0.3, cacheHitCount: 300 },
  byProject: [], byVirtualKey: [], byModel: [], byStatus: [], daily: [],
};
function wrap(detail: Record<string, unknown>) {
  return render(<I18nextProvider i18n={i18n}><ProviderUsageTab detail={detail as never} /></I18nextProvider>);
}

describe('ProviderUsageTab', () => {
  it('shows the loading placeholder when analytics have not loaded', () => {
    wrap({ analyticsData: undefined, navigate: vi.fn() });
    expect(screen.getByText(i18n.t('pages:providers.loadingUsageData'))).toBeInTheDocument();
  });

  it('renders the summary cards from the analytics payload', () => {
    wrap({ analyticsData, navigate: vi.fn() });
    expect(screen.getByText(i18n.t('pages:providers.totalRequests'))).toBeInTheDocument();
    // total-requests AnimatedNumber + cache-hit-rate label both render
    expect(screen.getByText(new RegExp(i18n.t('pages:providers.cacheHitRate')))).toBeInTheDocument();
  });
});
