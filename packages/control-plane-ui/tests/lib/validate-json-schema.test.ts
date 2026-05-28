import { describe, it, expect } from 'vitest';
import { validateDataAgainstJsonSchema } from '../../src/lib/validate-json-schema';

// Mirrors the gateway hook `configSchema` check: the SPA pre-validates a hook's
// config payload against its draft-07 schema before POSTing, so an admin sees
// the field-level error inline instead of a 400 from the server.
describe('validateDataAgainstJsonSchema', () => {
  const schema: Record<string, unknown> = {
    type: 'object',
    required: ['threshold'],
    properties: {
      threshold: { type: 'number', minimum: 0, maximum: 1 },
      mode: { type: 'string', enum: ['block', 'redact'] },
    },
    additionalProperties: false,
  };

  it('returns null when the data satisfies the schema', () => {
    expect(validateDataAgainstJsonSchema(schema, { threshold: 0.5, mode: 'block' })).toBeNull();
  });

  it('reports the missing required field', () => {
    const err = validateDataAgainstJsonSchema(schema, { mode: 'block' });
    expect(err).not.toBeNull();
    expect(err).toContain('threshold');
  });

  it('reports an out-of-range numeric value', () => {
    const err = validateDataAgainstJsonSchema(schema, { threshold: 5 });
    expect(err).toContain('1'); // maximum is 1
  });

  it('reports an enum violation', () => {
    const err = validateDataAgainstJsonSchema(schema, { threshold: 0.1, mode: 'silence' });
    expect(err).not.toBeNull();
  });

  it('joins multiple errors with a semicolon separator', () => {
    const err = validateDataAgainstJsonSchema(schema, { mode: 'silence', extra: true });
    expect(err).toContain(';');
  });

  it('applies a format keyword (ajv-formats wired)', () => {
    const emailSchema: Record<string, unknown> = {
      type: 'object',
      properties: { contact: { type: 'string', format: 'email' } },
    };
    expect(validateDataAgainstJsonSchema(emailSchema, { contact: 'ok@example.com' })).toBeNull();
    expect(validateDataAgainstJsonSchema(emailSchema, { contact: 'not-an-email' })).not.toBeNull();
  });
});
