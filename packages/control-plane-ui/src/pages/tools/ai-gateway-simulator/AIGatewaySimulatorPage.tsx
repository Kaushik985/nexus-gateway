import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ErrorBanner,
  PageHeader,
  Select,
  Stack,
} from '@/components/ui';
import {
  type RequestFormat,
} from '@/api/services/ai-gateway/aiGatewayClientSimulator';
import { FORMAT_OPTIONS } from './simulatorParams';
import { useSimulatorParams } from './useSimulatorParams';
import { useChatState } from './useChatState';
import { ParamsPopover } from './ParamsPopover';
import { ChatTimeline } from './ChatTimeline';
import { Composer } from './Composer';
import { SettingsDialog } from './SettingsDialog';
import styles from './AIGatewaySimulatorPage.module.css';

export function AIGatewaySimulatorPage() {
  const { t } = useTranslation();

  const {
    stdParams,
    customParams,
    activeParamCount,
    setStdParam,
    updateCustomParam,
    addCustomParam,
    removeCustomParam,
    resetParams,
  } = useSimulatorParams();

  const {
    vk,
    setVk,
    providerGroups,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,
    stream,
    setStream,
    format,
    setFormat,
    inputText,
    setInputText,
    messages,
    lastUsage,
    usageSummary,
    streamingAssistant,
    loadError,
    loadingModels,
    requestError,
    sending,
    providerOptions,
    modelOptions,
    canLoadModels,
    canSend,
    timelineRef,
    loadModels,
    refreshUsage,
    stopStreaming,
    clearConversation,
    send,
  } = useChatState();

  // UX state.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('pages:aiGatewaySimulator.title')}
        subtitle={t('pages:aiGatewaySimulator.subtitle')}
      />

      <div className={styles.toolbar}>
        <Stack direction="horizontal" gap="sm" align="center" style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.toolbarSelect}>
            <Select
              value={format}
              onValueChange={(v) => setFormat(v as RequestFormat)}
              options={FORMAT_OPTIONS}
              placeholder={t('pages:aiGatewaySimulator.format', 'Format')}
            />
          </div>
          <div className={styles.toolbarSelect}>
            <Select
              value={selectedProvider}
              onValueChange={(provider) => {
                setSelectedProvider(provider);
                const firstModel = providerGroups.find((g) => g.providerKey === provider)?.models[0]?.id ?? '';
                setSelectedModel(firstModel);
              }}
              options={providerOptions}
              disabled={providerOptions.length === 0}
              placeholder={t('pages:aiGatewaySimulator.selectProvider')}
            />
          </div>
          <div className={styles.toolbarSelect}>
            <Select
              value={selectedModel}
              onValueChange={setSelectedModel}
              options={modelOptions}
              disabled={!selectedProvider}
              placeholder={t('pages:aiGatewaySimulator.selectModel')}
            />
          </div>
        </Stack>
        <Stack direction="horizontal" gap="sm" align="center">
          <ParamsPopover
            paramsOpen={paramsOpen}
            setParamsOpen={setParamsOpen}
            activeParamCount={activeParamCount}
            stdParams={stdParams}
            customParams={customParams}
            setStdParam={setStdParam}
            updateCustomParam={updateCustomParam}
            addCustomParam={addCustomParam}
            removeCustomParam={removeCustomParam}
            resetParams={resetParams}
          />
          <Button variant="secondary" onClick={clearConversation} disabled={messages.length === 0 && !streamingAssistant}>
            {t('pages:aiGatewaySimulator.clear', 'Clear')}
          </Button>
          <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
            {t('pages:aiGatewaySimulator.openSettings', 'Settings')}
          </Button>
        </Stack>
      </div>

      {loadError ? <ErrorBanner message={loadError} onRetry={loadModels} /> : null}
      {requestError ? <ErrorBanner message={requestError} /> : null}

      <ChatTimeline
        timelineRef={timelineRef}
        messages={messages}
        streamingAssistant={streamingAssistant}
        selectedModel={selectedModel}
      />

      <Composer
        inputText={inputText}
        setInputText={setInputText}
        stream={stream}
        setStream={setStream}
        sending={sending}
        canSend={canSend}
        onSend={() => void send({ stdParams, customParams })}
        stopStreaming={stopStreaming}
      />

      <div className={styles.usageStrip}>
        <div className={styles.usageBlock}>
          <span className={styles.usageLabel}>{t('pages:aiGatewaySimulator.lastCompletionUsage')}</span>
          <span className={styles.usageValue}>
            {lastUsage
              ? `${lastUsage.prompt_tokens ?? '-'} / ${lastUsage.completion_tokens ?? '-'} / ${lastUsage.total_tokens ?? '-'}`
              : '—'}
          </span>
        </div>
        <div className={styles.usageBlock}>
          <span className={styles.usageLabel}>{t('pages:aiGatewaySimulator.summaryUsage')}</span>
          <span className={styles.usageValue}>
            {usageSummary?.usage
              ? `${usageSummary.usage.promptTokens ?? '-'} / ${usageSummary.usage.completionTokens ?? '-'} / ${usageSummary.usage.totalTokens ?? '-'} (${usageSummary.usage.totalRequests ?? '-'} req, $${usageSummary.usage.estimatedCostUsd ?? '-'})`
              : '—'}
          </span>
        </div>
        <Button variant="secondary" onClick={refreshUsage} disabled={!vk.trim()}>
          {t('pages:aiGatewaySimulator.refreshUsage')}
        </Button>
      </div>

      <SettingsDialog
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        vk={vk}
        setVk={setVk}
        loadModels={loadModels}
        loadingModels={loadingModels}
        canLoadModels={canLoadModels}
      />
    </div>
  );
}
