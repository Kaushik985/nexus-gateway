import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import { ProviderMultiSelect } from '../../../../src/components/ui/ProviderMultiSelect/ProviderMultiSelect';

const groups = [
  { provider: { id: 'p1', name: 'openai', displayName: 'OpenAI', enabled: true }, models: [] },
  { provider: { id: 'p2', name: 'anthropic', displayName: 'Anthropic', enabled: true }, models: [] },
  { provider: { id: 'p3', name: 'disabled-co', displayName: 'Disabled', enabled: false }, models: [] },
] as never[];

describe('ProviderMultiSelect', () => {
  it('lists only enabled providers as options', async () => {
    renderWithProviders(
      <ProviderMultiSelect label="Providers" value={[]} onChange={() => {}} providerGroups={groups} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: /OpenAI/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Anthropic/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Disabled/ })).toBeNull();
  });

  it('emits the provider id on select', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ProviderMultiSelect label="Providers" value={[]} onChange={onChange} providerGroups={groups} />,
    );
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('option', { name: /OpenAI/ }));
    expect(onChange).toHaveBeenCalledWith(['p1']);
  });
});
