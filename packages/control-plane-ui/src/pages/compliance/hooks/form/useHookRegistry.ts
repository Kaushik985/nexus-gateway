import { useState, useEffect } from 'react';
import { hookApi } from '@/api/services';
import type { AdminHookImplementationsResponse } from '@/api/types';

/**
 * Loads the admin hook implementation registry once on mount. Returns the raw
 * registry response (or null on error), the error message, and the convenience
 * `implementations` / `hookCategories` slices the form renders from.
 */
export function useHookRegistry() {
  const [registry, setRegistry] = useState<AdminHookImplementationsResponse | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hookApi.getImplementations();
        if (!cancelled) {
          setRegistry(res);
          setRegistryError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setRegistry(null);
          setRegistryError(e instanceof Error ? e.message : 'Failed to load hook registry');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const implementations = registry?.data ?? [];
  const hookCategories = registry?.hookCategories ?? [];

  return { registry, registryError, implementations, hookCategories };
}
