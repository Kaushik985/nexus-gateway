import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { ModelCodeTypeahead } from '@/pages/ai-gateway/routing/detail/ModelCodeTypeahead';

const sys = vi.hoisted(() => ({ systemApi: { listModelsFlat: vi.fn() } }));
vi.mock('@/api/services', () => sys);

// Controlled harness — free text is the source of truth, so the input value
// must round-trip through the parent for the debounced suggest to fire.
function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <I18nextProvider i18n={i18n}>
      <ModelCodeTypeahead value={value} onChange={(v) => { setValue(v); onChange(v); }} ariaLabel="model-code" />
    </I18nextProvider>
  );
}

describe('ModelCodeTypeahead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sys.systemApi.listModelsFlat.mockResolvedValue({ data: [{ id: 'm1', code: 'gpt-4o', name: 'GPT-4o', providerDisplay: 'OpenAI' }] });
  });

  it('debounce-queries the catalog and renders suggestions; picking one emits its code', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('model-code'), { target: { value: 'gpt' } });
    await waitFor(() => expect(sys.systemApi.listModelsFlat).toHaveBeenCalledWith(expect.objectContaining({ q: 'gpt', limit: '8' })));
    const option = await screen.findByRole('option');
    expect(option).toHaveTextContent('gpt-4o');
    expect(option).toHaveTextContent('OpenAI');
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('gpt-4o');
  });

  it('does not query for the "auto" sentinel', async () => {
    render(<Harness onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('model-code'), { target: { value: 'auto' } });
    // give the debounce window a chance — no fetch should fire
    await new Promise((r) => setTimeout(r, 250));
    expect(sys.systemApi.listModelsFlat).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape closes the suggestion popover', async () => {
    render(<Harness onChange={vi.fn()} />);
    const input = screen.getByLabelText('model-code');
    fireEvent.change(input, { target: { value: 'gpt' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });
});
