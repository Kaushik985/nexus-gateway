import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { NormalizedPayloadView } from '@/components/normalized/NormalizedPayloadView';

const wrap = (payload: unknown, extra: Record<string, unknown> = {}) =>
  render(<I18nextProvider i18n={i18n}><NormalizedPayloadView payload={payload as never} spans={[]} direction="request" {...extra} /></I18nextProvider>);

describe('NormalizedPayloadView', () => {
  it('renders ai-chat messages as role bubbles incl. tool_use', () => {
    wrap({
      kind: 'ai-chat', normalizeVersion: 'v2',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi there' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello back' }, { type: 'tool_use', toolUse: { name: 'web_search', input: { q: 'x' } } }] },
      ],
    });
    expect(screen.getByText('hi there')).toBeInTheDocument();
    expect(screen.getByText('hello back')).toBeInTheDocument();
    expect(screen.getByText(/web_search/)).toBeInTheDocument();
  });

  it('renders an ai-embedding payload', () => {
    const { container } = wrap({ kind: 'ai-embedding', normalizeVersion: 'v2', model: 'text-embedding-3', inputs: ['alpha', 'beta'] });
    expect((container.textContent || '').length).toBeGreaterThan(0);
  });

  it('renders an http-json payload', () => {
    const { container } = wrap({ kind: 'http-json', normalizeVersion: 'v2', http: { bodyView: { json: { hello: 'world' } } } });
    expect(container.textContent).toMatch(/hello/);
  });

  it('renders an http-binary metadata card', () => {
    wrap({ kind: 'http-binary', normalizeVersion: 'v2', http: { bodyView: { binaryRef: { size: 2048, contentType: 'application/octet-stream', sha256: 'abc123' } } } });
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it('renders the unsupported placeholder', () => {
    const { container } = wrap({ kind: 'unsupported', normalizeVersion: 'v2' });
    expect((container.textContent || '').length).toBeGreaterThan(0);
  });

  it('renders the redacted placeholder when content was dropped', () => {
    const { container } = wrap({ kind: 'ai-chat', normalizeVersion: 'v2', redacted: true, messages: [] });
    expect((container.textContent || '').length).toBeGreaterThan(0);
  });
});
