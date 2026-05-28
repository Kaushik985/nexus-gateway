import { describe, it, expect } from 'vitest';
import { defaultAIGatewayBaseUrl, aiguardComplianceWebhookUrl } from '../../src/lib/aiguardWebhook';

// The AI-Guard compliance webhook URL the admin copies into an external scanner
// config. It is derived from the browser host (so a console reached over a LAN
// IP or hostname points the scanner back at the same box's gateway on :3050),
// with an explicit override for non-standard deployments.
describe('defaultAIGatewayBaseUrl', () => {
  it('derives the gateway base from the current window host on :3050', () => {
    // jsdom default location.hostname is "localhost".
    expect(defaultAIGatewayBaseUrl()).toBe('http://localhost:3050');
  });
});

describe('aiguardComplianceWebhookUrl', () => {
  it('appends the webhook path to the derived default base', () => {
    expect(aiguardComplianceWebhookUrl()).toBe(
      'http://localhost:3050/v1/ai-guard/compliance-webhook',
    );
  });

  it('uses an explicit base URL when provided', () => {
    expect(aiguardComplianceWebhookUrl('https://gw.example.com')).toBe(
      'https://gw.example.com/v1/ai-guard/compliance-webhook',
    );
  });

  it('strips trailing slashes from the base before joining', () => {
    expect(aiguardComplianceWebhookUrl('https://gw.example.com///')).toBe(
      'https://gw.example.com/v1/ai-guard/compliance-webhook',
    );
  });

  it('falls back to the default when given an empty string', () => {
    expect(aiguardComplianceWebhookUrl('')).toBe(
      'http://localhost:3050/v1/ai-guard/compliance-webhook',
    );
  });
});
