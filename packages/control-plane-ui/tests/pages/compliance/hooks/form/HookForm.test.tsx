/**
 * Integration test — HookForm renders the applicableIngress picker and
 * preselects the hook row's current value (with ALL as the default for new
 * rows). The picker backs the hooks-audit §10 #1 feature; see decision log
 * for context.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';

import { renderWithRouter, server, http, HttpResponse } from '@/test/test-utils';
import { HookForm } from '../../../../../src/pages/compliance/hooks/form/HookForm';
import { mockHook } from '@/test/msw-handlers';
import { aiguardComplianceWebhookUrl } from '@/lib/aiguardWebhook';
import i18n from '@/i18n';

function renderForm(hook?: Parameters<typeof HookForm>[0]['hook'], onSaved: () => void = vi.fn()) {
  return renderWithRouter(
    <HookForm hook={hook} onClose={vi.fn()} onSaved={onSaved} />,
  );
}

describe('HookForm applicableIngress picker', () => {
  it('renders the picker with ALL preselected when creating a new hook', async () => {
    renderForm(undefined);
    // MultiSelectDropdown summarises the selected labels inside the trigger.
    await waitFor(() => {
      expect(screen.getAllByText(/All ingress types/i).length).toBeGreaterThan(0);
    });
  });

  it('preselects the existing applicableIngress value when editing', async () => {
    const { classification: _c, ...rest } = mockHook;
    void _c;
    const hook = { ...rest, applicableIngress: ['AI_GATEWAY'] };
    renderForm(hook);
    await waitFor(() => {
      expect(screen.getAllByText(/^AI Gateway$/i).length).toBeGreaterThan(0);
    });
  });

  it('keeps ALL exclusive when selecting specific ingress options', async () => {
    renderForm(undefined);

    await waitFor(() => {
      expect(screen.getAllByText(/All ingress types/i).length).toBeGreaterThan(0);
    });

    const trigger = screen.getByRole('button', { name: /Applicable ingress/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText(/^AI Gateway$/i));

    await waitFor(() => {
      expect(screen.getAllByText(/^AI Gateway$/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/All ingress types, AI Gateway/i)).toBeNull();
    });
  });

  it('normalizes mixed persisted ingress values when reopening edit', async () => {
    const { classification: _c, ...rest } = mockHook;
    void _c;
    const hook = { ...rest, applicableIngress: ['ALL', 'AI_GATEWAY'] };
    renderForm(hook);

    await waitFor(() => {
      expect(screen.getAllByText(/^AI Gateway$/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/All ingress types, AI Gateway/i)).toBeNull();
  });

  it('renders multiple selected ingress codes in edit mode', async () => {
    const { classification: _c, ...rest } = mockHook;
    void _c;
    const hook = { ...rest, applicableIngress: ['AI_GATEWAY', 'COMPLIANCE_PROXY'] };
    renderForm(hook);

    await waitFor(() => {
      expect(screen.getByText(/AI Gateway,\s*Compliance Proxy/i)).toBeDefined();
    });
  });

  it('shows AIGuard target when webhook endpoint matches built-in URL', async () => {
    const { classification: _c, ...rest } = mockHook;
    void _c;
    const endpoint = aiguardComplianceWebhookUrl();
    const hook = { ...rest, type: 'webhook', implementationId: 'webhook-forward', endpoint };
    renderForm(hook);

    await waitFor(() => {
      expect(screen.getByDisplayValue(endpoint)).toBeDefined();
      expect(screen.getAllByText('AIGuard').length).toBeGreaterThan(0);
    });
  });
});

describe('HookForm save', () => {
  it('saving an edited hook PUTs to /api/admin/hooks/:id and calls onSaved', async () => {
    const putSpy = vi.fn(() => HttpResponse.json({ ...mockHook }));
    server.use(http.put('/api/admin/hooks/:id', putSpy));
    const onSaved = vi.fn();
    // edit view needs: classification.supportedStages.join(...) + a resolvable
    // implementationId (matches the default implementations MSW) so the Save
    // button isn't disabled (!selectedImplementationId).
    const hook = { ...mockHook, implementationId: 'pii-detector', classification: { ...mockHook.classification, supportedStages: ['request', 'response'] } };
    renderForm(hook, onSaved);

    // form is pre-filled from the hook (config {} → manual JSON '{}'); save it
    await waitFor(() => expect(screen.getByDisplayValue(mockHook.name)).toBeInTheDocument());
    const saveBtn = screen.getByRole('button', { name: i18n.t('common:save') });
    await waitFor(() => expect(saveBtn).toBeEnabled());
    fireEvent.click(saveBtn);

    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
