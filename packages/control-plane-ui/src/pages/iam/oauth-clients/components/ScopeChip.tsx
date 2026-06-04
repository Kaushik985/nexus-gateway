import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui';
import styles from './ScopeChip.module.css';

/**
 * Static mapping from a canonical scope name to the i18n suffix used under
 * `iam.oauthClients.scopeExplanation.*` and the chip tone. Scope names like
 * `traffic:write` can't appear as JSON property names, so the suffix is a
 * separate kebab-stripped key (`trafficWrite`, `shadowRead`).
 *
 * Unknown scopes fall through to the `customScope` chip; admins can
 * register arbitrary scope tokens server-side and we render them with the
 * raw value so they remain recognisable.
 */
type ScopeTone = 'neutral' | 'warning';

interface ScopeMeta {
  /** Suffix under `iam.oauthClients.scopeExplanation.<suffix>`. */
  explanationKey: string;
  tone: ScopeTone;
  /** Suffix under `iam.oauthClients.scopeWarning.<suffix>` for the warning tone. */
  warningKey?: string;
}

const SCOPE_META: Record<string, ScopeMeta> = {
  openid: { explanationKey: 'openid', tone: 'neutral' },
  profile: { explanationKey: 'profile', tone: 'neutral' },
  email: { explanationKey: 'email', tone: 'neutral' },
  offline_access: { explanationKey: 'offline_access', tone: 'neutral' },
  admin: { explanationKey: 'admin', tone: 'warning', warningKey: 'admin' },
  'traffic:write': { explanationKey: 'trafficWrite', tone: 'neutral' },
};

export interface ScopeChipProps {
  scope: string;
}

export function ScopeChip({ scope }: ScopeChipProps) {
  const { t } = useTranslation();
  const meta = SCOPE_META[scope];
  const isKnown = meta !== undefined;

  const tone: ScopeTone = meta?.tone ?? 'neutral';
  const explanation = isKnown
    ? t(`pages:iam.oauthClients.scopeExplanation.${meta!.explanationKey}`)
    : t('pages:iam.oauthClients.scopeExplanation.customScope');

  const warning = meta?.warningKey
    ? t(`pages:iam.oauthClients.scopeWarning.${meta.warningKey}`)
    : undefined;

  const tooltipContent = warning ?? explanation;

  return (
    <Tooltip content={tooltipContent}>
      <span
        className={tone === 'warning' ? styles.chipWarning : styles.chipNeutral}
        data-testid="scope-chip"
        data-scope={scope}
        data-tone={tone}
      >
        <span className={styles.scopeText}>{scope}</span>
        <span className={styles.scopeExplanation}>{explanation}</span>
      </span>
    </Tooltip>
  );
}
