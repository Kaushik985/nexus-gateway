import type { SemanticCacheConfig } from '@/api/types';

export type VaryBy = 'none' | 'user' | 'vk' | 'org';
export type EmbedStrategy =
  | 'last_user'
  | 'system_plus_last_user'
  | 'recent_turns'
  | 'head_plus_tail'
  | 'full_truncated';

export interface Draft {
  embeddingProviderId: string | null;
  embeddingModelId: string | null;
  embeddingDimension: number | null;
  enabled: boolean;
  threshold: number;
  varyBy: VaryBy;
  embedStrategy: EmbedStrategy;
  allowCrossModel: boolean;
}

export function configToDraft(cfg: SemanticCacheConfig): Draft {
  return {
    embeddingProviderId: cfg.embeddingProviderId ?? null,
    embeddingModelId: cfg.embeddingModelId ?? null,
    embeddingDimension: cfg.embeddingDimension ?? null,
    enabled: cfg.enabled,
    threshold: cfg.threshold,
    varyBy: cfg.varyBy,
    embedStrategy: cfg.embedStrategy,
    allowCrossModel: cfg.allowCrossModel,
  };
}

export function isDraftChanged(draft: Draft, saved: SemanticCacheConfig): boolean {
  return (
    draft.embeddingProviderId !== (saved.embeddingProviderId ?? null) ||
    draft.embeddingModelId !== (saved.embeddingModelId ?? null) ||
    draft.enabled !== saved.enabled ||
    draft.threshold !== saved.threshold ||
    draft.varyBy !== saved.varyBy ||
    draft.embedStrategy !== saved.embedStrategy ||
    draft.allowCrossModel !== saved.allowCrossModel
  );
}

export function isModelChanged(draft: Draft, saved: SemanticCacheConfig): boolean {
  return (
    draft.embeddingProviderId !== (saved.embeddingProviderId ?? null) ||
    draft.embeddingModelId !== (saved.embeddingModelId ?? null)
  );
}
