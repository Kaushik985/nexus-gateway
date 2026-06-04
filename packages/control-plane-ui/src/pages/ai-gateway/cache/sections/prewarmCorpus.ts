import type { PrewarmEntry } from '@/api/services/cache/semanticPrewarm';

// ── Pre-warm corpus parsing / validation ──────────────────────────────────

export const PREWARM_MAX_ENTRIES = 500;
export const PREWARM_MIN_TTL = 60;
export const PREWARM_MAX_TTL = 604800;

export function parseCorpus(raw: string): PrewarmEntry[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Empty input');

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((item, i) => {
      if (typeof item !== 'object' || item === null) {
        throw new Error(`Entry ${i}: expected object`);
      }
      const e = item as Record<string, unknown>;
      if (typeof e['prompt'] !== 'string') throw new Error(`Entry ${i}: "prompt" must be a string`);
      if (typeof e['response'] !== 'string') throw new Error(`Entry ${i}: "response" must be a string`);
      return {
        prompt: e['prompt'] as string,
        response: e['response'] as string,
        model: typeof e['model'] === 'string' ? e['model'] : undefined,
        vkScope: typeof e['vkScope'] === 'string' ? e['vkScope'] : undefined,
        ttlSeconds: typeof e['ttlSeconds'] === 'number' ? e['ttlSeconds'] : undefined,
      };
    });
  }

  const lines = trimmed.split('\n').filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV requires a header row and at least one data row');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const promptIdx = header.indexOf('prompt');
  const responseIdx = header.indexOf('response');
  if (promptIdx === -1) throw new Error('CSV header missing "prompt" column');
  if (responseIdx === -1) throw new Error('CSV header missing "response" column');
  const modelIdx = header.indexOf('model');
  const vkScopeIdx = header.indexOf('vkscope');
  const ttlIdx = header.indexOf('ttl_seconds');

  return lines.slice(1).map((line, i) => {
    const cols = line.split(',');
    const prompt = (cols[promptIdx] ?? '').trim();
    const response = (cols[responseIdx] ?? '').trim();
    if (!prompt) throw new Error(`CSV row ${i + 2}: "prompt" is empty`);
    if (!response) throw new Error(`CSV row ${i + 2}: "response" is empty`);
    const ttlRaw = ttlIdx >= 0 ? Number((cols[ttlIdx] ?? '').trim()) : NaN;
    return {
      prompt,
      response,
      model: modelIdx >= 0 ? (cols[modelIdx] ?? '').trim() || undefined : undefined,
      vkScope: vkScopeIdx >= 0 ? (cols[vkScopeIdx] ?? '').trim() || undefined : undefined,
      ttlSeconds: !isNaN(ttlRaw) && ttlRaw > 0 ? ttlRaw : undefined,
    };
  });
}

export function validateCorpus(entries: PrewarmEntry[]): string[] {
  const errors: string[] = [];
  if (entries.length === 0) errors.push('No entries found');
  if (entries.length > PREWARM_MAX_ENTRIES) {
    errors.push(`Too many entries: ${entries.length} (max ${PREWARM_MAX_ENTRIES})`);
  }
  entries.forEach((e, i) => {
    if (!e.prompt) errors.push(`Entry ${i}: prompt is empty`);
    if (!e.response) errors.push(`Entry ${i}: response is empty`);
    if (e.ttlSeconds !== undefined && (e.ttlSeconds < PREWARM_MIN_TTL || e.ttlSeconds > PREWARM_MAX_TTL)) {
      errors.push(`Entry ${i}: ttlSeconds ${e.ttlSeconds} out of range [${PREWARM_MIN_TTL}, ${PREWARM_MAX_TTL}]`);
    }
  });
  return errors;
}
