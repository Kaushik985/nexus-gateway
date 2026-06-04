import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Msg, ToolChip } from './ChatWithNexus';
import { AssistantText } from './MarkdownMessage';

// safeJson pretty-prints a tool's structured input for the expanded chip, tolerating a
// non-serialisable value (it should always be plain JSON from the SSE event, but never
// let a render throw).
function safeJson(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ToolChips renders the per-turn tool-activity chips. A chip whose tool carried a
// structured input is a button that toggles an inline panel showing that input, so the
// user can see exactly what the assistant ran (e.g. the query it searched). Chips
// without an input stay plain text.
function ToolChips({ tools }: { tools: ToolChip[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const hasInput = (tool: ToolChip) =>
    tool.input != null && (typeof tool.input !== 'object' || Object.keys(tool.input as object).length > 0);
  return (
    <div className="mb-1 flex flex-col gap-1">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {tools.map((tool, j) => {
          const icon = tool.status === 'error' ? '✗' : tool.status === 'ok' ? '✓' : '…';
          const label = `▸ ${tool.name} ${icon}`;
          return hasInput(tool) ? (
            <button
              key={j}
              type="button"
              aria-label={t('common:assistant.toolDetails', { name: tool.name })}
              aria-expanded={open === j}
              onClick={() => setOpen((cur) => (cur === j ? null : j))}
              className="rounded underline-offset-2 hover:text-foreground hover:underline"
            >
              {label}
            </button>
          ) : (
            <span key={j}>{label}</span>
          );
        })}
      </div>
      {open != null && tools[open] && hasInput(tools[open]) && (
        <pre className="overflow-x-auto rounded-md border border-border bg-background p-2 text-xs text-foreground">
          {safeJson(tools[open].input)}
        </pre>
      )}
    </div>
  );
}

interface MessageListProps {
  messages: Msg[];
  streaming: boolean;
  downloadFile: (id: string) => Promise<boolean>;
  fileIdsIn: (text: string) => string[];
}

// MessageList renders the message scroll area: each turn's bubble, tool chips,
// error bubbles, the streaming placeholder, and per-file download buttons.
// Stateless — the parent owns the transcript and streaming state.
export function MessageList({ messages, streaming, downloadFile, fileIdsIn }: MessageListProps) {
  const { t } = useTranslation();
  return messages.length === 0 ? (
    <p className="text-sm text-muted-foreground">{t('common:assistant.empty')}</p>
  ) : (
    <>
      {messages.map((m, i) => (
        <div key={i} className={cn('text-sm', m.role === 'user' ? 'text-right' : 'text-left')}>
          {m.tools && m.tools.length > 0 && <ToolChips tools={m.tools} />}
          {m.role === 'error' ? (
            <span className="inline-block rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
              {`⚠ ${m.text}`}
            </span>
          ) : m.role === 'user' ? (
            // User turns stay a right-aligned bubble showing their text verbatim
            // (preserved whitespace, no markdown — it is the operator's literal input).
            <span className="inline-block max-w-full whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-left text-primary-foreground">
              {m.text}
            </span>
          ) : (
            // Assistant turns render as Markdown in a full-width block (so code blocks
            // and tables get room). The last in-flight turn animates via the typewriter
            // reveal; an empty in-flight turn shows the streaming placeholder.
            <div className="rounded-lg bg-muted px-3 py-2 text-left text-foreground">
              {m.text ? (
                <AssistantText text={m.text} animate={streaming && i === messages.length - 1} />
              ) : streaming && i === messages.length - 1 ? (
                <span className="text-muted-foreground">…</span>
              ) : null}
            </div>
          )}
          {m.role === 'assistant' &&
            // Primary source: the structured `file` SSE events (m.files), robust to the
            // model not echoing the URL. Fallback: scrape ids from the message text, the
            // only signal for transcripts loaded from history (no live SSE replay).
            // Union + de-dupe by id.
            Array.from(new Set([...(m.files ?? []).map((f) => f.id), ...fileIdsIn(m.text)])).map((fid) => (
              <button
                key={fid}
                type="button"
                onClick={() => void downloadFile(fid)}
                className="mt-1 block text-xs text-primary underline hover:opacity-80"
              >
                {`⬇ ${t('common:assistant.download')}`}
              </button>
            ))}
        </div>
      ))}
    </>
  );
}
