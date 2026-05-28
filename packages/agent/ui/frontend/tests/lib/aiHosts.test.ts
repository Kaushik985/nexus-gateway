import { describe, it, expect } from 'vitest';
import { isAIHost } from '../../src/lib/aiHosts';

// Glob registry of known AI-service hostnames. Patterns are exact (anchored),
// case-insensitive, with * as wildcard.
describe('isAIHost', () => {
  it('matches exact known AI hosts', () => {
    expect(isAIHost('chatgpt.com')).toBe(true);
    expect(isAIHost('claude.ai')).toBe(true);
    expect(isAIHost('api.mistral.ai')).toBe(true);
    expect(isAIHost('generativelanguage.googleapis.com')).toBe(true);
  });

  it('matches wildcard subdomains', () => {
    expect(isAIHost('chat.openai.com')).toBe(true);
    expect(isAIHost('foo.claude.ai')).toBe(true);
    expect(isAIHost('myresource.openai.azure.com')).toBe(true);
  });

  it('matches multi-wildcard Bedrock regional endpoints', () => {
    expect(isAIHost('bedrock-runtime.us-east-1.amazonaws.com')).toBe(true);
    expect(isAIHost('foo.bedrock-runtime.eu-west-1.amazonaws.com')).toBe(true);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isAIHost('  ChatGPT.com  ')).toBe(true);
    expect(isAIHost('API.X.AI')).toBe(true);
  });

  it('rejects unknown hosts', () => {
    expect(isAIHost('example.com')).toBe(false);
    expect(isAIHost('notopenai.com.evil.com')).toBe(false); // anchored: no substring match
    expect(isAIHost('openai.com.attacker.net')).toBe(false);
  });

  it('rejects empty / null / whitespace-only', () => {
    expect(isAIHost('')).toBe(false);
    expect(isAIHost(null)).toBe(false);
    expect(isAIHost(undefined)).toBe(false);
    expect(isAIHost('   ')).toBe(false);
  });

  it('rejects IP literals (v4 + v6) without running globs', () => {
    expect(isAIHost('192.168.1.10')).toBe(false);
    expect(isAIHost('10.0.0.1')).toBe(false);
    expect(isAIHost('::1')).toBe(false);
    expect(isAIHost('2606:4700::1')).toBe(false);
  });
});
