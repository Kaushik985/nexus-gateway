import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';
import { useZodForm } from '../../../src/lib/forms/useZodForm';
import { FormInput } from '../../../src/lib/forms/FormInput';
import { FormSelect } from '../../../src/lib/forms/FormSelect';
import { FormTextarea } from '../../../src/lib/forms/FormTextarea';

// The Form* components are the React-Hook-Form ↔ design-system bridge: they
// register a field, bind its value, surface the Zod validation message through
// FormField, and render the required marker. The harness mounts all three in a
// real form and asserts that observable behavior.
const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  kind: z.string().min(1, 'Pick a kind'),
  notes: z.string().max(5, 'Too long'),
});

function Harness() {
  const form = useZodForm({
    schema,
    defaultValues: { name: '', kind: '', notes: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(() => {})}>
      <FormInput form={form} name="name" label="Name" required helpText="Your full name" />
      <FormSelect
        form={form}
        name="kind"
        label="Kind"
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />
      <FormTextarea form={form} name="notes" label="Notes" rows={3} />
      <button type="submit">Save</button>
    </form>
  );
}

describe('Form field bridge components', () => {
  it('renders labels, help text, and the required marker', () => {
    render(<Harness />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Your full name')).toBeInTheDocument();
    expect(screen.getByText('Kind')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    // FormField renders a "*" for required fields.
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('binds typed input back into the form value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Name', { exact: false }) as HTMLInputElement;
    await user.type(input, 'Ada');
    expect(input.value).toBe('Ada');
  });

  it('surfaces the Zod validation message on invalid submit', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Pick a kind')).toBeInTheDocument();
  });

  it('FormTextarea binds and validates its own value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const textarea = screen.getByLabelText('Notes', { exact: false }) as HTMLTextAreaElement;
    await user.type(textarea, 'waytoolong');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Too long')).toBeInTheDocument();
  });
});
