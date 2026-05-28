import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ConditionalRoutingEditor } from '@/pages/ai-gateway/routing/editor/ConditionalRoutingEditor';
import { emptyConditionalFormState, newConditionalBranchRow } from '@/pages/ai-gateway/routing/_shared/routing-rule-config';

const providerGroups = [
  { provider: { id: 'p1', name: 'openai', displayName: 'OpenAI' }, models: [{ id: 'm1', providerModelId: 'gpt-4o', name: 'GPT-4o' }] },
] as never;

function formValue() {
  return { mode: 'form' as const, form: { ...emptyConditionalFormState(), branches: [newConditionalBranchRow()] } };
}
function jsonValue(text = '{"type":"conditional","conditions":[],"default":{"type":"single"}}') {
  return { mode: 'json' as const, text };
}
function wrap(value: ReturnType<typeof formValue> | ReturnType<typeof jsonValue>, onChange = vi.fn()) {
  render(<I18nextProvider i18n={i18n}><ConditionalRoutingEditor value={value as never} onChange={onChange} providerGroups={providerGroups} /></I18nextProvider>);
  return onChange;
}

describe('ConditionalRoutingEditor', () => {
  beforeEach(() => i18n.changeLanguage('en'));

  it('form mode shows the default-route + conditions sections and a JSON escape hatch', () => {
    wrap(formValue());
    expect(screen.getByText(i18n.t('pages:routing.defaultRoute'))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages:routing.conditions'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('pages:routing.editAsRawJson') })).toBeInTheDocument();
  });

  it('switching to raw JSON emits a json-mode hydration', () => {
    const onChange = wrap(formValue());
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:routing.editAsRawJson') }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'json', text: expect.any(String) }));
  });

  it('json mode renders the editor; editing emits json text, and structured-editor switches back to form', () => {
    const onChange = wrap(jsonValue());
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '{"type":"single"}' } });
    expect(onChange).toHaveBeenCalledWith({ mode: 'json', text: '{"type":"single"}' });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('pages:routing.useStructuredEditor') }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'form' }));
  });

  it('changing the default-route provider emits an updated form', () => {
    const onChange = wrap(formValue());
    // first combobox is the default-route provider select
    const providerSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(providerSelect, { target: { value: 'openai' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'form', form: expect.objectContaining({ defaultProvider: 'openai' }) }));
  });
});
