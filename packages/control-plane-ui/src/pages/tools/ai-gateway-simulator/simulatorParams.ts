import {
  type RequestFormat,
  type RequestParams,
} from '@/api/services/ai-gateway/aiGatewayClientSimulator';

export interface ProviderModelOption {
  id: string;
  label: string;
}

export interface ProviderGroup {
  providerKey: string;
  providerLabel: string;
  models: ProviderModelOption[];
}

export function groupModelsByProvider(
  models: Array<{ id: string; name?: string; owned_by?: string; owner_display_name?: string }>,
): ProviderGroup[] {
  const byProvider = new Map<string, { label: string; models: Map<string, string> }>();
  for (const model of models) {
    const providerKey = model.owned_by?.trim() || 'unknown';
    const providerLabel = model.owner_display_name?.trim() || providerKey;
    const current = byProvider.get(providerKey) ?? { label: providerLabel, models: new Map<string, string>() };
    const label = model.name?.trim() || model.id;
    current.models.set(model.id, label);
    if (model.owner_display_name?.trim()) current.label = model.owner_display_name.trim();
    byProvider.set(providerKey, current);
  }
  return Array.from(byProvider.entries())
    .map(([providerKey, value]) => ({
      providerKey,
      providerLabel: value.label,
      models: Array.from(value.models.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => a.providerLabel.localeCompare(b.providerLabel));
}

export type StandardParamKey =
  | 'temperature'
  | 'max_tokens'
  | 'top_p'
  | 'presence_penalty'
  | 'frequency_penalty'
  | 'seed'
  | 'stop'
  | 'system';

export type ParamKind = 'number' | 'integer' | 'text';

export interface StandardParamMeta {
  kind: ParamKind;
  defaultValue: string;
}

export interface ParamRowState {
  enabled: boolean;
  value: string;
}

export const STANDARD_PARAM_META: Record<StandardParamKey, StandardParamMeta> = {
  temperature: { kind: 'number', defaultValue: '1.0' },
  max_tokens: { kind: 'integer', defaultValue: '1024' },
  top_p: { kind: 'number', defaultValue: '1.0' },
  presence_penalty: { kind: 'number', defaultValue: '0' },
  frequency_penalty: { kind: 'number', defaultValue: '0' },
  seed: { kind: 'integer', defaultValue: '' },
  stop: { kind: 'text', defaultValue: '' },
  system: { kind: 'text', defaultValue: '' },
};

export const STANDARD_PARAM_ORDER: StandardParamKey[] = [
  'temperature',
  'max_tokens',
  'top_p',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'stop',
  'system',
];

export function makeInitialParams(): Record<StandardParamKey, ParamRowState> {
  const out = {} as Record<StandardParamKey, ParamRowState>;
  for (const k of STANDARD_PARAM_ORDER) {
    out[k] = { enabled: false, value: STANDARD_PARAM_META[k].defaultValue };
  }
  return out;
}

export interface CustomParam {
  /** Stable id for React keys. Generated client-side; never sent to server. */
  id: string;
  enabled: boolean;
  key: string;
  /** User-typed string. Parsed as JSON at send time when possible — so
   * `{"type":"enabled","budget_tokens":2000}` lands as a nested object,
   * but plain strings/numbers still work. */
  value: string;
}

export function newCustomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Best-effort: try JSON.parse(value) so an object/array/number reaches
 * the wire body as a structured type, otherwise pass the raw string. */
export function parseCustomValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

/** Translate the UI's row-by-row param state into the wire-body
 * RequestParams shape, omitting any row whose checkbox is off. Numeric
 * values fall back to the default when the operator typed garbage —
 * the error path then surfaces from the upstream API rather than from a
 * silent client-side coercion. */
export function buildRequestParams(
  std: Record<StandardParamKey, ParamRowState>,
  custom: CustomParam[],
): RequestParams {
  const out: RequestParams = {};
  for (const k of STANDARD_PARAM_ORDER) {
    const row = std[k];
    if (!row.enabled) continue;
    const meta = STANDARD_PARAM_META[k];
    if (meta.kind === 'number' || meta.kind === 'integer') {
      const n = meta.kind === 'integer' ? Number.parseInt(row.value, 10) : Number(row.value);
      if (Number.isFinite(n)) {
        (out as Record<string, unknown>)[k] = n;
      }
    } else {
      if (row.value.length > 0) {
        (out as Record<string, unknown>)[k] = row.value;
      }
    }
  }
  if (custom.length > 0) {
    const cp: Record<string, unknown> = {};
    for (const row of custom) {
      if (!row.enabled || row.key.trim() === '') continue;
      cp[row.key.trim()] = parseCustomValue(row.value);
    }
    if (Object.keys(cp).length > 0) out.customParams = cp;
  }
  return out;
}

export const FORMAT_OPTIONS: Array<{ value: RequestFormat; label: string }> = [
  { value: 'openai', label: 'OpenAI Chat (/v1/chat/completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses (/v1/responses)' },
  { value: 'anthropic', label: 'Anthropic Messages (/v1/messages)' },
  { value: 'gemini', label: 'Gemini (/v1beta/.../:generateContent)' },
];
