import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeContext, useTheme, type ThemeContextValue } from '../../src/theme/ThemeContext';
import { DEFAULT_THEME } from '../../src/theme/themeLoader';

function Probe() {
  const { themeId, brand } = useTheme();
  return (
    <div>
      <span data-testid="id">{themeId}</span>
      <span data-testid="brand">{brand.productName}</span>
    </div>
  );
}

describe('useTheme', () => {
  it('throws when used outside a <ThemeProvider>', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useTheme must be used inside a <ThemeProvider>');
    spy.mockRestore();
  });

  it('returns the provided context value when inside a provider', () => {
    const value: ThemeContextValue = {
      mode: 'system',
      resolvedMode: 'light',
      setMode: () => {},
      theme: DEFAULT_THEME,
      themeId: 'morningstar',
      setThemeId: () => {},
      brand: DEFAULT_THEME.brand,
    };
    render(
      <ThemeContext.Provider value={value}>
        <Probe />
      </ThemeContext.Provider>,
    );
    expect(screen.getByTestId('id').textContent).toBe('morningstar');
    expect(screen.getByTestId('brand').textContent).toBe(DEFAULT_THEME.brand.productName);
  });
});
