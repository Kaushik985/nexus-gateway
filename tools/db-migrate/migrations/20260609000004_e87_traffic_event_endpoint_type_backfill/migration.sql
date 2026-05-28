-- E87: add + canonicalize traffic_event.endpoint_type.
--
-- The original version of this migration only UPDATE'd endpoint_type,
-- assuming an earlier migration had already added the column. No such
-- migration ever existed, so on a real `prisma migrate deploy` (prod) the
-- UPDATE failed with SQLSTATE 42703 (column does not exist). Local dev
-- masked this because it builds the schema via `prisma db push` from
-- schema.prisma (which also lacked the column) and never runs migrations.
-- This migration now creates the column first, then normalizes any legacy
-- values — making the add+canonicalize atomic and correct on every path.
--
-- The column carries the canonical typology.EndpointKind vocabulary
-- ("chat", "embeddings", "stt", "tts", "image_generation", "batch", ...),
-- stamped by the producing service onto audit.Record.EndpointType and
-- persisted by the Hub db-writer. Empty string for non-AI traffic
-- (compliance-proxy / agent forwards) that does not classify a modality.
ALTER TABLE "traffic_event"
  ADD COLUMN IF NOT EXISTS "endpoint_type" TEXT NOT NULL DEFAULT '';

-- Canonicalize any rows that carry the former audit-string vocabulary for
-- the chat family. On a freshly-added column every row is '' so this is a
-- no-op; it stays for idempotency and to document the canonical mapping
-- (mirrors packages/shared/transport/typology KindFromPathSegment, where
-- all three legacy segments resolve to EndpointKindChat). The WHERE clause
-- keeps re-runs a no-op once every row carries a canonical string.
UPDATE "traffic_event"
   SET "endpoint_type" = 'chat'
 WHERE "endpoint_type" IN ('chat/completions', 'responses', 'completions');
