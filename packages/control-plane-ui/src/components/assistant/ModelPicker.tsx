import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover';
import type { ModelOption } from './streamChat';

interface ModelPickerProps {
  /** The selectable models (already filtered + ranked by the backend). */
  models: ModelOption[];
  /** The currently selected model code. */
  value: string;
  /** Set the selected model code. */
  onChange: (code: string) => void;
}

// groupByProvider buckets models into an ordered list of provider groups, preserving the
// backend's model ordering within each group and the first-seen order of providers. A
// model with no provider name is grouped under the "" key (rendered without a header).
function groupByProvider(models: ModelOption[]): { provider: string; models: ModelOption[] }[] {
  const order: string[] = [];
  const byProvider = new Map<string, ModelOption[]>();
  for (const m of models) {
    const key = m.provider;
    if (!byProvider.has(key)) {
      byProvider.set(key, []);
      order.push(key);
    }
    byProvider.get(key)!.push(m);
  }
  return order.map((provider) => ({ provider, models: byProvider.get(provider)! }));
}

// ModelPicker is the searchable, provider-grouped model selector that lives in the chat
// header. The trigger shows the current model's label; the popover holds a search box (it
// filters by label, code, or provider, case-insensitively) and a scrollable list grouped
// under small provider headers. Picking a model sets the code and closes the popover. It is
// deliberately compact — it floats inside a small popup header.
export function ModelPicker({ models, value, onChange }: ModelPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const currentLabel = useMemo(
    () => models.find((m) => m.code === value)?.label ?? value,
    [models, value],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter(
          (m) =>
            m.label.toLowerCase().includes(q) ||
            m.code.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q),
        )
      : models;
    return groupByProvider(filtered);
  }, [models, query]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('common:assistant.model')}
          className="max-w-[9rem] truncate rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {currentLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-64 max-w-[calc(100vw-2rem)] !p-0 text-xs"
      >
        <div className="border-b border-border p-2">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common:assistant.modelSearch')}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {groups.length === 0 ? (
            <div className="px-2 py-1.5 text-muted-foreground">{t('common:assistant.modelNoMatch')}</div>
          ) : (
            groups.map((g) => (
              <div key={g.provider || '_none'} className="mb-1 last:mb-0">
                {g.provider && (
                  <div className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.provider}
                  </div>
                )}
                {g.models.map((m) => (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => pick(m.code)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-foreground transition-colors hover:bg-muted',
                      m.code === value && 'bg-muted',
                    )}
                  >
                    <span className="truncate">{m.label}</span>
                    {m.code === value && <span aria-hidden="true" className="text-muted-foreground">✓</span>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
