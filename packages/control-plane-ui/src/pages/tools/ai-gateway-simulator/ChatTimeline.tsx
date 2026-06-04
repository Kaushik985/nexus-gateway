import { useTranslation } from 'react-i18next';
import { type SimulatorChatMessage } from '@/api/services/ai-gateway/aiGatewayClientSimulator';
import styles from './AIGatewaySimulatorPage.module.css';

interface ChatTimelineProps {
  timelineRef: React.RefObject<HTMLDivElement | null>;
  messages: SimulatorChatMessage[];
  streamingAssistant: string;
  selectedModel: string;
}

export function ChatTimeline({
  timelineRef,
  messages,
  streamingAssistant,
  selectedModel,
}: ChatTimelineProps) {
  const { t } = useTranslation();

  return (
    <div ref={timelineRef} className={styles.chatTimeline}>
      {messages.length === 0 && !streamingAssistant ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{t('pages:aiGatewaySimulator.emptyTitle', 'Start a chat')}</p>
          <p className={styles.emptyHint}>
            {selectedModel
              ? t('pages:aiGatewaySimulator.emptyHintReady', 'Type a prompt below and press Cmd/Ctrl+Enter to send.')
              : t('pages:aiGatewaySimulator.emptyHintNoModel', 'Open Settings to set the gateway URL + virtual key, then Load models.')}
          </p>
        </div>
      ) : null}
      {messages.map((m, idx) => (
        <div
          key={`${m.role}-${idx}`}
          className={`${styles.bubbleRow} ${m.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAssistant}`}
        >
          <div className={`${styles.bubble} ${m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}`}>
            <div className={styles.bubbleRole}>{m.role}</div>
            <div className={styles.bubbleContent}>{m.content}</div>
          </div>
        </div>
      ))}
      {streamingAssistant ? (
        <div className={`${styles.bubbleRow} ${styles.bubbleRowAssistant}`}>
          <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
            <div className={styles.bubbleRole}>assistant</div>
            <div className={styles.bubbleContent}>{streamingAssistant}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
