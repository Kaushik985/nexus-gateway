/**
 * ScopeChip — surfaces a canonical OAuth scope with an inline plain-English
 * explanation. Tests assert: the warning tone fires for `admin`, neutral for
 * everything else, and unknown scopes fall through to the customScope
 * explanation while preserving the raw token.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { ScopeChip } from '../../../../src/pages/iam/oauth-clients/components/ScopeChip';

describe('ScopeChip', () => {
  it('renders openid with the OIDC sign-in explanation and neutral tone', () => {
    renderWithProviders(<ScopeChip scope="openid" />);
    const chip = screen.getByTestId('scope-chip');
    expect(chip).toHaveAttribute('data-scope', 'openid');
    expect(chip).toHaveAttribute('data-tone', 'neutral');
    expect(chip).toHaveTextContent('openid');
    expect(chip).toHaveTextContent('OpenID Connect sign-in');
  });

  it('renders admin with the warning tone', () => {
    renderWithProviders(<ScopeChip scope="admin" />);
    const chip = screen.getByTestId('scope-chip');
    expect(chip).toHaveAttribute('data-tone', 'warning');
    expect(chip).toHaveTextContent('admin');
    expect(chip).toHaveTextContent('Full Control Plane admin access');
  });

  it('renders profile with the profile-claims explanation', () => {
    renderWithProviders(<ScopeChip scope="profile" />);
    expect(screen.getByTestId('scope-chip')).toHaveTextContent('User profile claims');
  });

  it('renders the traffic:write scope with its trafficWrite explanation', () => {
    renderWithProviders(<ScopeChip scope="traffic:write" />);
    const chip = screen.getByTestId('scope-chip');
    expect(chip).toHaveAttribute('data-scope', 'traffic:write');
    expect(chip).toHaveTextContent('Submit traffic events');
  });

  it('falls through to Custom scope for unknown values, preserving the raw token', () => {
    renderWithProviders(<ScopeChip scope="my:custom:scope" />);
    const chip = screen.getByTestId('scope-chip');
    expect(chip).toHaveAttribute('data-scope', 'my:custom:scope');
    expect(chip).toHaveAttribute('data-tone', 'neutral');
    expect(chip).toHaveTextContent('my:custom:scope');
    expect(chip).toHaveTextContent('Custom scope');
  });
});
