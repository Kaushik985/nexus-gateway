import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { TrafficFileSinkNotice } from '../../../../src/pages/traffic/list/TrafficFileSinkNotice';

const wrap = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe('TrafficFileSinkNotice', () => {
  it('renders the configured path as <code> text (full variant)', () => {
    const { container } = wrap(<TrafficFileSinkNotice variant="full" filePath="/var/log/nexus/traffic.jsonl" />);
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('/var/log/nexus/traffic.jsonl');
  });
  it('falls back to the placeholder path when none is given (compact variant)', () => {
    const { container } = wrap(<TrafficFileSinkNotice variant="compact" filePath={null} />);
    // A <code> still renders, carrying the i18n fallback (non-empty).
    expect(container.querySelector('code')?.textContent?.length).toBeGreaterThan(0);
  });
});
