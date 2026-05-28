import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { JsonEditor } from '@/components/ui/JsonEditor/JsonEditor';

describe('JsonEditor', () => {
  it('surfaces a parse error for invalid JSON as you type', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonEditor label="Config" value="" onChange={onChange} />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '{ bad' } });
    expect(onChange).toHaveBeenCalledWith('{ bad');
    expect(screen.getByRole('alert')).toBeInTheDocument(); // FormField error region
  });

  it('clears the error for valid JSON', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonEditor label="Config" value="" onChange={onChange} />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '{"a":1}' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Format button pretty-prints valid JSON', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonEditor label="Config" value='{"a":1}' onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /format/i }));
    expect(onChange).toHaveBeenCalledWith('{\n  "a": 1\n}');
  });

  it('Format button is a no-op on invalid JSON', () => {
    const onChange = vi.fn();
    renderWithProviders(<JsonEditor label="Config" value="{ bad" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /format/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
