import { describe, it, expect } from 'vitest';
import { validateIamPolicyDocument } from '../../../../src/pages/iam/_shared/iam-policy-document';

const okStmt = { Effect: 'Allow', Action: 'admin:provider.read', Resource: '*' };
const okDoc = { Version: '2026-03-28', Statement: [okStmt] };

describe('validateIamPolicyDocument', () => {
  it('accepts a well-formed document', () => {
    expect(validateIamPolicyDocument(okDoc)).toEqual({ valid: true, errors: [] });
  });

  it('rejects non-objects', () => {
    expect(validateIamPolicyDocument(null).valid).toBe(false);
    expect(validateIamPolicyDocument('x').errors[0]).toMatch(/must be an object/);
  });

  it('requires a string Version', () => {
    const r = validateIamPolicyDocument({ Statement: [okStmt] });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/Version is required/);
  });

  it('requires Statement to be an array (and bails early)', () => {
    const r = validateIamPolicyDocument({ Version: 'v', Statement: 'nope' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('Statement must be an array');
  });

  it('flags an empty statement array', () => {
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [] }).errors.join()).toMatch(
      /at least one statement/,
    );
  });

  it('flags exceeding the max statement count', () => {
    const many = Array.from({ length: 51 }, () => okStmt);
    expect(validateIamPolicyDocument({ Version: 'v', Statement: many }).errors.join()).toMatch(
      /exceeds maximum of 50/,
    );
  });

  it('flags a non-object statement', () => {
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [123] }).errors.join()).toMatch(
      /Statement\[0\]: must be an object/,
    );
  });

  it('requires Effect to be Allow or Deny', () => {
    const r = validateIamPolicyDocument({ Version: 'v', Statement: [{ ...okStmt, Effect: 'Maybe' }] });
    expect(r.errors.join()).toMatch(/Effect must be "Allow" or "Deny"/);
  });

  it('accepts Action/Resource as string or non-empty array', () => {
    const r = validateIamPolicyDocument({
      Version: 'v',
      Statement: [{ Effect: 'Deny', Action: ['a:b', 'c:d'], Resource: ['nrn:1'] }],
    });
    expect(r.valid).toBe(true);
  });

  it('rejects missing / empty-array / non-string Action entries', () => {
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [{ Effect: 'Allow', Resource: '*' }] }).errors.join())
      .toMatch(/Action must be a string or non-empty array/);
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [{ Effect: 'Allow', Action: [], Resource: '*' }] }).errors.join())
      .toMatch(/Action must be a string or non-empty array/);
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [{ Effect: 'Allow', Action: [''], Resource: '*' }] }).errors.join())
      .toMatch(/Action entries must be non-empty strings/);
  });

  it('rejects consecutive wildcards', () => {
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [{ Effect: 'Allow', Action: 'a:**', Resource: '*' }] }).errors.join())
      .toMatch(/consecutive wildcards/);
  });

  it('validates the Condition block (type, operators, value shape)', () => {
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [{ ...okStmt, Condition: 'x' }] }).errors.join())
      .toMatch(/Condition must be an object/);
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [{ ...okStmt, Condition: { Bogus: {} } }] }).errors.join())
      .toMatch(/unknown operator "Bogus"/);
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [{ ...okStmt, Condition: { StringEquals: 'x' } }] }).errors.join())
      .toMatch(/Condition.StringEquals must be an object/);
    expect(validateIamPolicyDocument({ Version: 'v', Statement: [{ ...okStmt, Condition: { StringEquals: { 'k': 'v' } } }] }).valid)
      .toBe(true);
  });
});
