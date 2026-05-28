import { describe, it, expect } from 'vitest';
import * as ui from '../src/index';

// Importing the package root executes each barrel's re-export line, and pins
// that the public surface other packages consume stays exported.
describe('ui-shared public surface', () => {
  it('re-exports the shared components + theme primitives', () => {
    for (const name of [
      'Button',
      'Chip',
      'ErrorBanner',
      'IconButton',
      'LinkButton',
      'useTheme',
      'ThemeContext',
      'loadTheme',
      'applyThemeTokens',
      'getSeriesColors',
      'REQUIRED_THEME_TOKENS',
      'cn',
    ]) {
      expect(ui).toHaveProperty(name);
    }
  });
});
