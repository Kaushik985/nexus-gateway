import { useTranslation } from 'react-i18next';
import type { SessionMeta } from './streamChat';

interface SessionHistoryProps {
  showHistory: boolean;
  sessions: SessionMeta[];
  loadSession: (id: string) => void;
  removeSession: (id: string) => void;
}

// SessionHistory renders the history panel: the caller's own conversations with
// load + delete actions. Stateless — list data and actions are threaded from the
// parent, which owns the showHistory toggle and the server calls. Renders nothing
// until showHistory is set.
export function SessionHistory({ showHistory, sessions, loadSession, removeSession }: SessionHistoryProps) {
  const { t } = useTranslation();
  if (!showHistory) return null;
  return sessions.length === 0 ? (
    <p className="text-sm text-muted-foreground">{t('common:assistant.noSessions')}</p>
  ) : (
    <>
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-muted">
          <button
            type="button"
            onClick={() => void loadSession(s.id)}
            className="flex-1 truncate text-left text-sm"
          >
            {s.title || s.id}
          </button>
          <button
            type="button"
            aria-label={t('common:assistant.deleteSession')}
            title={t('common:assistant.deleteSession')}
            onClick={() => void removeSession(s.id)}
            className="text-muted-foreground transition-colors hover:text-destructive"
          >
            <span aria-hidden="true">🗑</span>
          </button>
        </div>
      ))}
    </>
  );
}
