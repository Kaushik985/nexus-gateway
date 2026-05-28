import { describe, expect, it } from 'vitest';
import {
  getAxisTickStyle,
  getGridStroke,
  getPieColors,
  getSemanticColor,
  getSeriesColors,
  getTooltipStyle,
} from '../../src/theme/chartColors';

describe('prime-aligned chart colors', () => {
  it('uses the prime brand blue as the lead light-mode series color', () => {
    expect(getSeriesColors('light')[0]).toBe('#3b518a');
    expect(getSemanticColor('light', 'requests')).toBe('#3b518a');
    expect(getSemanticColor('light', 'promptCache')).toBe('#3b518a');
  });

  it('keeps dark charts readable on the dark prime shell', () => {
    expect(getSeriesColors('dark')[0]).toBe('#8ea4da');
    expect(getSemanticColor('dark', 'requests')).toBe('#8ea4da');
    expect(getGridStroke('dark')).toBe('var(--color-border)');
  });

  it('returns token-backed tooltip and axis styles for both modes', () => {
    expect(getPieColors('light')[0]).toBe('#3b518a');
    expect(getTooltipStyle('light')).toMatchObject({
      background: 'var(--color-surface-overlay)',
      color: 'var(--color-text)',
    });
    expect(getAxisTickStyle('dark')).toMatchObject({
      fill: 'var(--color-text-tertiary)',
    });
  });
});

import { render } from '@testing-library/react';
import {
  getPhaseColor,
  getPhaseColors,
  useChartSeriesColors,
  useChartPieColors,
  useChartSemanticColor,
  useChartPhaseColor,
} from '../../src/theme/chartColors';
import { ThemeContext, type ThemeContextValue } from '../../src/theme/ThemeContext';
import { DEFAULT_THEME } from '../../src/theme/themeLoader';
import type { ThemeConfig } from '../../src/theme/ThemeConfig';

describe('chartColors — phase palette + theme overrides', () => {
  it('returns latency-phase colours per mode', () => {
    expect(getPhaseColor('light', 'ttfb')).toBe('#f59e0b');
    expect(getPhaseColor('dark', 'ttfb')).toBe('#fbbf24');
    expect(getPhaseColors('light').body).toBe('#10b981');
    expect(getPhaseColors('dark').body).toBe('#34d399');
  });

  it('prefers a theme-supplied chart override over the built-in palette', () => {
    const theme: ThemeConfig = {
      ...DEFAULT_THEME,
      charts: {
        series: { light: ['#abc123'], dark: ['#def456'] },
        pie: { light: ['#111111'], dark: ['#222222'] },
        semantic: { requests: { light: '#999000', dark: '#000999' } },
      },
    } as ThemeConfig;
    expect(getSeriesColors('light', theme)[0]).toBe('#abc123');
    expect(getPieColors('dark', theme)[0]).toBe('#222222');
    expect(getSemanticColor('light', 'requests', theme)).toBe('#999000');
  });

  it('covers the light-mode grid + tooltip branches', () => {
    expect(getGridStroke('light')).toBe('var(--color-border-light)');
    expect(getTooltipStyle('dark').boxShadow).toBe('var(--shadow-lg)');
    expect(getAxisTickStyle('light').fill).toBe('var(--color-text-secondary)');
  });
});

describe('chartColors hooks (read the active theme)', () => {
  function wrap(resolvedMode: 'light' | 'dark', theme: ThemeConfig = DEFAULT_THEME) {
    const value: ThemeContextValue = {
      mode: resolvedMode,
      resolvedMode,
      setMode: () => {},
      theme,
      themeId: theme.id,
      setThemeId: () => {},
      brand: theme.brand,
    };
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
    };
  }

  it('useChartSeriesColors / Pie / Semantic / Phase read mode from context', () => {
    const captured: Record<string, unknown> = {};
    function Probe() {
      captured.series = useChartSeriesColors();
      captured.pie = useChartPieColors();
      captured.semantic = useChartSemanticColor('cost');
      captured.phase = useChartPhaseColor('ttfb');
      return null;
    }
    const Wrapper = wrap('dark');
    render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    expect((captured.series as string[])[0]).toBe('#8ea4da');
    expect((captured.pie as string[])[0]).toBe('#8ea4da');
    expect(captured.semantic).toBe('#fb923c'); // dark cost
    expect(captured.phase).toBe('#fbbf24'); // dark ttfb
  });
});
