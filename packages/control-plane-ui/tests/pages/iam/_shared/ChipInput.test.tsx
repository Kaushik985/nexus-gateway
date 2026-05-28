import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChipInput } from '@/pages/iam/_shared/ChipInput';

function Harness({ onChange, initial = '', suggestions, validate }: { onChange: (v: string) => void; initial?: string; suggestions?: string[]; validate?: (c: string) => boolean }) {
  const [value, setValue] = useState(initial);
  return <ChipInput value={value} onChange={(v) => { setValue(v); onChange(v); }} ariaLabel="actions" suggestions={suggestions} validate={validate} />;
}

describe('ChipInput', () => {
  it('renders one chip per newline-delimited value', () => {
    render(<Harness onChange={vi.fn()} initial={'admin:provider.read\nadmin:model.*'} />);
    expect(screen.getByText('admin:provider.read')).toBeInTheDocument();
    expect(screen.getByText('admin:model.*')).toBeInTheDocument();
  });

  it('Enter and comma both commit the typed chip (deduped)', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText('actions');
    fireEvent.change(input, { target: { value: 'admin:a' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('admin:a');
    fireEvent.change(input, { target: { value: 'admin:b' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenLastCalledWith('admin:a\nadmin:b');
  });

  it('Backspace on an empty field removes the last chip', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial={'a\nb'} />);
    const input = screen.getByLabelText('actions');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('selects a highlighted suggestion with ArrowDown + Enter', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} suggestions={['admin:provider.read', 'admin:provider.create']} />);
    const input = screen.getByLabelText('actions');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'provider' } });
    // ArrowDown moves highlight from index 0 → 1, Enter commits that suggestion
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('admin:provider.create');
  });

  it('flags an invalid chip via the validate predicate (title hint)', () => {
    render(<Harness onChange={vi.fn()} initial="bogus:action" validate={(c) => c.startsWith('admin:')} />);
    expect(screen.getByText('bogus:action')).toBeInTheDocument();
  });
});
