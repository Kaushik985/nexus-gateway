import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import styles from './RoutingRuleCreate.module.css';

export const WIZARD_STEP_KEYS = [
  'wizardStepBasicInfo',
  'wizardStepConfiguration',
  'wizardStepFallback',
  'wizardStepMatchConditions',
] as const;
export const WIZARD_TOTAL_STEPS = WIZARD_STEP_KEYS.length;

export function WizardStepBar({ current, onStepClick }: { current: number; onStepClick: (step: number) => void }) {
  const { t } = useTranslation();
  const labels = WIZARD_STEP_KEYS.map(k => t(`pages:routing.${k}`));

  return (
    <div className={styles.wizardStepBar}>
      {labels.map((label, i) => {
        const isActive = i === current;
        const isCompleted = i < current;

        return (
          <div key={label} className={styles.wizardStepItem} onClick={() => onStepClick(i)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onStepClick(i); }}>
            <div className={styles.wizardStepContent}>
              <div
                className={clsx(
                  styles.wizardStepCircle,
                  isActive && styles.wizardStepCircleActive,
                  isCompleted && styles.wizardStepCircleCompleted,
                  !isActive && !isCompleted && styles.wizardStepCirclePending,
                )}
              >
                {isCompleted ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={clsx(
                  isActive && styles.wizardStepLabelActiveColor,
                  isCompleted && styles.wizardStepLabelCompleted,
                  !isActive && !isCompleted && styles.wizardStepLabelMuted,
                )}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div
                className={clsx(
                  styles.wizardStepConnector,
                  isCompleted ? styles.wizardStepConnectorCompleted : styles.wizardStepConnectorPending,
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
