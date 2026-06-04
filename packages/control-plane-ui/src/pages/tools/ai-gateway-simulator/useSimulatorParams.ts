import { useMemo, useState } from 'react';
import {
  type CustomParam,
  type ParamRowState,
  type StandardParamKey,
  STANDARD_PARAM_ORDER,
  makeInitialParams,
  newCustomId,
} from './simulatorParams';

export interface UseSimulatorParams {
  stdParams: Record<StandardParamKey, ParamRowState>;
  customParams: CustomParam[];
  activeParamCount: number;
  setStdParam: (key: StandardParamKey, patch: Partial<ParamRowState>) => void;
  updateCustomParam: (id: string, patch: Partial<CustomParam>) => void;
  addCustomParam: () => void;
  removeCustomParam: (id: string) => void;
  resetParams: () => void;
}

export function useSimulatorParams(): UseSimulatorParams {
  // Per-request knobs: each standard param has its own checkbox+value
  // row, plus an open-ended list of custom params for provider-specific
  // extensions the simulator doesn't surface as first-class checkboxes.
  // Default state: every checkbox off so requests land at the upstream
  // exactly the way the model defaults expect — flipping a model from
  // OpenAI to Claude doesn't carry over a stale `temperature: 0.7` that
  // the new model would reject.
  const [stdParams, setStdParams] = useState<Record<StandardParamKey, ParamRowState>>(() =>
    makeInitialParams(),
  );
  const [customParams, setCustomParams] = useState<CustomParam[]>([]);

  // Active-count badge on the Params button — quick sanity ("am I
  // sending temperature right now?") without opening the popover.
  const activeParamCount = useMemo(() => {
    let n = 0;
    for (const k of STANDARD_PARAM_ORDER) {
      if (stdParams[k].enabled) n++;
    }
    for (const c of customParams) {
      if (c.enabled && c.key.trim() !== '') n++;
    }
    return n;
  }, [stdParams, customParams]);

  const setStdParam = (key: StandardParamKey, patch: Partial<ParamRowState>) => {
    setStdParams((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };
  const updateCustomParam = (id: string, patch: Partial<CustomParam>) => {
    setCustomParams((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  const addCustomParam = () => {
    setCustomParams((prev) => [...prev, { id: newCustomId(), enabled: true, key: '', value: '' }]);
  };
  const removeCustomParam = (id: string) => {
    setCustomParams((prev) => prev.filter((p) => p.id !== id));
  };
  const resetParams = () => {
    setStdParams(makeInitialParams());
    setCustomParams([]);
  };

  return {
    stdParams,
    customParams,
    activeParamCount,
    setStdParam,
    updateCustomParam,
    addCustomParam,
    removeCustomParam,
    resetParams,
  };
}
