import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComplianceTagChipList, ComplianceTagChipInput } from '@/pages/traffic/list/ComplianceTagChips';

describe('ComplianceTagChipList', () => {
  it('renders one chip per tag', () => {
    render(<ComplianceTagChipList tags={['severity:high', 'compliance:pii', 'detector:cs', 'category:violence', 'other:x']} />);
    for (const tag of ['severity:high', 'compliance:pii', 'detector:cs', 'category:violence', 'other:x']) {
      expect(screen.getByText(tag)).toBeInTheDocument();
    }
  });

  it('renders the empty label when there are no tags (and null without one)', () => {
    const { rerender, container } = render(<ComplianceTagChipList tags={[]} emptyLabel="No tags" />);
    expect(screen.getByText('No tags')).toBeInTheDocument();
    rerender(<ComplianceTagChipList tags={[]} />);
    expect(container.textContent).toBe('');
  });

  it('shows a remove button per chip when onRemove is provided', () => {
    const onRemove = vi.fn();
    render(<ComplianceTagChipList tags={['compliance:pii']} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag compliance:pii' }));
    expect(onRemove).toHaveBeenCalledWith('compliance:pii');
  });
});

function ChipInputHarness({ onChange }: { onChange: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  return <ComplianceTagChipInput value={value} onChange={(v) => { setValue(v); onChange(v); }} ariaLabel="tags" />;
}

describe('ComplianceTagChipInput', () => {
  it('commits a tag on Enter and on comma, deduping repeats', () => {
    const onChange = vi.fn();
    render(<ChipInputHarness onChange={onChange} />);
    const input = screen.getByLabelText('tags');
    fireEvent.change(input, { target: { value: 'severity:high' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['severity:high']);
    // comma commits the next tag
    fireEvent.change(input, { target: { value: 'compliance:pii' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenLastCalledWith(['severity:high', 'compliance:pii']);
    // duplicate is ignored (no onChange with a 3rd entry)
    onChange.mockClear();
    fireEvent.change(input, { target: { value: 'severity:high' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Backspace on an empty field pops the last chip', () => {
    const onChange = vi.fn();
    render(<ChipInputHarness onChange={onChange} />);
    const input = screen.getByLabelText('tags');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'b' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    onChange.mockClear();
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith(['a']);
  });

  it('commits a pending draft on blur and removes a chip via its button', () => {
    const onChange = vi.fn();
    render(<ChipInputHarness onChange={onChange} />);
    const input = screen.getByLabelText('tags');
    fireEvent.change(input, { target: { value: 'category:x' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(['category:x']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag category:x' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
