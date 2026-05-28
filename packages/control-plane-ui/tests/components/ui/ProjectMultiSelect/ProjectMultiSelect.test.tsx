import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/test-utils';
import { ProjectMultiSelect } from '../../../../src/components/ui/ProjectMultiSelect/ProjectMultiSelect';

const listProjects = vi.fn();
const listOrgs = vi.fn();
vi.mock('@/api/services', () => ({
  projectApi: { list: () => listProjects() },
  organizationApi: { list: () => listOrgs() },
}));

describe('ProjectMultiSelect', () => {
  beforeEach(() => {
    listProjects.mockResolvedValue({ data: [
      { id: 'pr1', name: 'Billing', organizationId: 'o1' },
      { id: 'pr2', name: 'Search', organizationId: 'o2', organization: { name: 'Acme' } },
    ], total: 2 });
    listOrgs.mockResolvedValue({ data: [{ id: 'o1', name: 'Globex' }] });
  });

  it('renders composite "Org / Project" labels (org resolved by id or embedded)', async () => {
    renderWithProviders(<ProjectMultiSelect label="Projects" value={[]} onChange={() => {}} />);
    await userEvent.click(await screen.findByRole('button'));
    expect(await screen.findByRole('option', { name: /Globex \/ Billing/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Acme \/ Search/ })).toBeInTheDocument();
  });
});
