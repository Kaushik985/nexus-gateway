import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// useTypewriter reveals `full` progressively while `active`, decoupling the visible
// length from the (chunky) arrival of streamed SSE deltas so the reply appears as
// smooth typing instead of landing in jumps. When `active` is false it shows `full`
// immediately — completed turns and history transcripts render in one shot. The
// reveal accelerates when it falls behind a burst so it never lags far behind the
// real stream, and snaps to full the moment streaming ends.
export function useTypewriter(full: string, active: boolean): string {
  const [count, setCount] = useState(active ? 0 : full.length);
  // The cursor is mirrored in a ref so the rAF step reads the CURRENT value
  // synchronously: deciding whether to re-arm off the state updater is unreliable
  // (React runs updaters lazily at render, so the decision would read a stale value).
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    if (!active) {
      setCount(full.length);
      return;
    }
    let raf = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const c = countRef.current;
      if (c >= full.length) return; // caught up → stop; the [full] dep re-arms on new text
      // ~2 chars/frame (≈120 cps at 60fps) for a readable typing cadence, scaled up when
      // a backlog builds so a long reply or a reconnect burst catches up fast.
      const inc = Math.max(2, Math.ceil((full.length - c) / 10));
      const next = Math.min(full.length, c + inc);
      countRef.current = next;
      setCount(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [full, active]);

  // `full.slice` clamps a cursor that briefly exceeds a shrunk `full`, so no separate
  // clamp pass is needed (a new turn mounts a fresh component with count 0 anyway).
  return active ? full.slice(0, count) : full;
}

// strip drops the hast `node` prop react-markdown v9 injects into every custom
// component, so it is never forwarded to a DOM element (React warns on an unknown
// `node` attribute, which would otherwise fire for every node on every render).
function strip<P extends { node?: unknown }>({ node: _node, ...props }: P) {
  return props;
}

// MarkdownMessage renders assistant text as GitHub-flavored Markdown styled ENTIRELY
// through semantic design tokens (no raw colors), so it tracks the active light/dark
// theme. Raw HTML is not rendered (react-markdown's safe default), so model output
// cannot inject markup. Code blocks sit on a contrasting `bg-background` panel because
// the assistant bubble itself is `bg-muted`.
export const MarkdownMessage = memo(function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (p) => (
            <a
              {...strip(p)}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            />
          ),
          p: (p) => <p {...strip(p)} className="my-1 whitespace-pre-wrap break-words" />,
          ul: (p) => <ul {...strip(p)} className="my-1 list-disc space-y-0.5 pl-5" />,
          ol: (p) => <ol {...strip(p)} className="my-1 list-decimal space-y-0.5 pl-5" />,
          li: (p) => <li {...strip(p)} className="break-words" />,
          h1: (p) => <h1 {...strip(p)} className="mb-1 mt-2 text-base font-semibold" />,
          h2: (p) => <h2 {...strip(p)} className="mb-1 mt-2 text-base font-semibold" />,
          h3: (p) => <h3 {...strip(p)} className="mb-1 mt-2 text-sm font-semibold" />,
          // Inline code gets the chip styling; block code lives inside `pre`, which
          // neutralises this chip styling on its child `code` so it is not doubled.
          code: (p) => (
            <code {...strip(p)} className="rounded bg-background px-1 py-0.5 font-mono text-[0.85em]" />
          ),
          pre: (p) => (
            <pre
              {...strip(p)}
              className="my-2 overflow-x-auto rounded-md border border-border bg-background p-3 text-xs [&_code]:bg-transparent [&_code]:p-0"
            />
          ),
          blockquote: (p) => (
            <blockquote {...strip(p)} className="my-2 border-l-2 border-border pl-3 text-muted-foreground" />
          ),
          table: (p) => (
            <div className="my-2 overflow-x-auto">
              <table {...strip(p)} className="w-full border-collapse text-xs" />
            </div>
          ),
          th: (p) => <th {...strip(p)} className="border border-border px-2 py-1 text-left font-semibold" />,
          td: (p) => <td {...strip(p)} className="border border-border px-2 py-1" />,
          hr: (p) => <hr {...strip(p)} className="my-2 border-border" />,
          strong: (p) => <strong {...strip(p)} className="font-semibold" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

// AssistantText is the streaming-aware wrapper. While the turn is in flight it shows the
// typewriter-revealed text as PLAIN text (preserved whitespace): slicing Markdown source
// mid-token would flash broken tables / unterminated code fences and re-parse the whole
// buffer every frame. Once the turn completes (animate=false) it renders the full text as
// Markdown. So you get smooth typing during the stream and clean formatting at the end.
export function AssistantText({ text, animate }: { text: string; animate: boolean }) {
  const visible = useTypewriter(text, animate);
  if (animate) {
    return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{visible}</div>;
  }
  return <MarkdownMessage text={text} />;
}
