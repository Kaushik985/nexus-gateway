import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { AccountPanel, AboutFooter } from '@/pages/activity/AccountPanel';
import type { StatusSnapshot } from '@/api/agent';
const status = { agent: { version: '1.2.3', deviceId: 'dev-1', enrolled: true, email: 'a@x.io' }, gatewayConnected: true, daemonRunning: true } as unknown as StatusSnapshot;
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nextProvider i18n={i18n}>{ui}</I18nextProvider></QueryClientProvider>);
};
describe('AccountPanel', () => {
  it('renders without crashing', () => {
    const { container } = wrap(<AccountPanel status={status} />);
    expect((container.textContent || '').length).toBeGreaterThan(0);
  });
  it('AboutFooter renders the agent version', () => {
    const { container } = wrap(<AboutFooter status={status} />);
    expect(container.textContent).toMatch(/1\.2\.3/);
  });
});
