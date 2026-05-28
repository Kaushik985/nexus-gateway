import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ReliabilityCell } from '@/pages/ai-gateway/credentials/ReliabilityCell';

const past = new Date(Date.now() - 90_000).toISOString();
const future = new Date(Date.now() + 120_000).toISOString();
function wrap(cred: Record<string, unknown>) {
  return render(<I18nextProvider i18n={i18n}><ReliabilityCell cred={cred as never} /></I18nextProvider>);
}

describe('ReliabilityCell', () => {
  it('open circuit renders the open label + popover details (rate, collecting, live fails)', () => {
    wrap({
      circuitState: 'open', circuitReason: 'rate_limit', circuitOpenedAt: past, circuitNextProbeAt: future,
      liveCircuit: { authFailsCurrent: 2 }, healthStatus: 'unavailable',
      healthSuccessRate5m: 0.5, healthSuccessRate1h: 0.6, healthSamplesObserved: 3,
      healthDominantError: 'timeout', healthTrend: 'down', healthCheckedAt: past,
    });
    expect(screen.getByText(i18n.t('pages:credentials.reliability_open'))).toBeInTheDocument();
    expect(screen.getByText(/50\.0%/)).toBeInTheDocument(); // 5m success rate
    expect(screen.getByText('2')).toBeInTheDocument(); // live auth fails
  });

  it('half_open circuit renders the half-open label', () => {
    wrap({ circuitState: 'half_open', healthStatus: 'degraded' });
    expect(screen.getAllByText(i18n.t('pages:credentials.reliability_half_open')).length).toBeGreaterThan(0);
  });

  it('degraded health (no circuit) renders the degraded label', () => {
    wrap({ circuitState: 'closed', healthStatus: 'degraded', healthSamplesObserved: 50 });
    expect(screen.getAllByText(i18n.t('pages:credentials.health_degraded', { defaultValue: 'degraded' })).length).toBeGreaterThan(0);
  });

  it('available health renders the available label', () => {
    wrap({ circuitState: 'closed', healthStatus: 'available', healthSuccessRate5m: 0.99, healthSamplesObserved: 100 });
    expect(screen.getAllByText(i18n.t('pages:credentials.health_available', { defaultValue: 'available' })).length).toBeGreaterThan(0);
  });

  it('no health + closed circuit renders the unknown label', () => {
    wrap({ circuitState: 'closed' });
    expect(screen.getAllByText(i18n.t('pages:credentials.health_unknown')).length).toBeGreaterThan(0);
  });
});
