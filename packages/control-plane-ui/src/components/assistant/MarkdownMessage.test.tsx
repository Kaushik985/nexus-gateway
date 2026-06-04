import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MarkdownMessage, AssistantText } from './MarkdownMessage';

describe('MarkdownMessage', () => {
  it('renders GFM markdown: bold, links, and fenced code blocks', () => {
    const { container } = render(
      <MarkdownMessage text={'Hello **world** and [docs](https://example.com)\n\n```\ncode line\n```'} />,
    );
    // bold → <strong>
    const strong = container.querySelector('strong');
    expect(strong?.textContent).toBe('world');
    // link → <a target=_blank rel=noreferrer>
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noreferrer');
    // fenced code → <pre><code>
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.querySelector('code')?.textContent).toContain('code line');
  });

  it('renders a GFM table (remark-gfm enabled)', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |';
    const { container } = render(<MarkdownMessage text={md} />);
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelectorAll('th').length).toBe(2);
    expect(container.querySelectorAll('td').length).toBe(2);
  });

  it('does not render raw HTML (safe default — no script injection)', () => {
    const { container } = render(<MarkdownMessage text={'<img src=x onerror=alert(1)>'} />);
    // react-markdown escapes raw HTML rather than mounting it
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('AssistantText typewriter', () => {
  it('shows the full text immediately when not animating (completed turn / history)', () => {
    const { container } = render(<AssistantText text={'final answer'} animate={false} />);
    expect(container.textContent).toBe('final answer');
  });

  it('progressively reveals then settles on the full text while animating', async () => {
    const { container } = render(<AssistantText text={'streamed reply'} animate={true} />);
    // The reveal is driven by requestAnimationFrame; it converges on the full string.
    await waitFor(() => expect(container.textContent).toBe('streamed reply'));
  });
});
