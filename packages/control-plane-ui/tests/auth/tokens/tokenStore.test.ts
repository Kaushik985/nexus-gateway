import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '../../../src/auth/tokens/tokenStore';

describe('tokenStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns undefined when no tokens are stored', () => {
    expect(getAccessToken()).toBeUndefined();
    expect(getRefreshToken()).toBeUndefined();
  });

  it('stores + retrieves tokens', () => {
    setTokens({ accessToken: 'at-1', refreshToken: 'rt-1' });
    expect(getAccessToken()).toBe('at-1');
    expect(getRefreshToken()).toBe('rt-1');
  });

  it('overwrites on repeated setTokens', () => {
    setTokens({ accessToken: 'at-1', refreshToken: 'rt-1' });
    setTokens({ accessToken: 'at-2', refreshToken: 'rt-2' });
    expect(getAccessToken()).toBe('at-2');
    expect(getRefreshToken()).toBe('rt-2');
  });

  it('clearTokens removes both entries', () => {
    setTokens({ accessToken: 'at', refreshToken: 'rt' });
    clearTokens();
    expect(getAccessToken()).toBeUndefined();
    expect(getRefreshToken()).toBeUndefined();
  });

  it('clearTokens is safe when nothing is stored', () => {
    expect(() => clearTokens()).not.toThrow();
  });
});

describe('tokenStore — storage unavailable / failing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('treats an absent localStorage as no tokens', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getAccessToken()).toBeUndefined();
    expect(getRefreshToken()).toBeUndefined();
    // Writes/clears must be no-ops, not throws, when storage is absent.
    expect(() => setTokens({ accessToken: 'a', refreshToken: 'b' })).not.toThrow();
    expect(() => clearTokens()).not.toThrow();
  });

  it('returns undefined when getItem throws (private-mode read)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(getAccessToken()).toBeUndefined();
    expect(getRefreshToken()).toBeUndefined();
  });

  it('swallows a throwing setItem (quota / private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setTokens({ accessToken: 'a', refreshToken: 'b' })).not.toThrow();
  });

  it('swallows a throwing removeItem', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearTokens()).not.toThrow();
  });
});
