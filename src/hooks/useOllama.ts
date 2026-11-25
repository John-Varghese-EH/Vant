import { useState, useEffect, useCallback } from 'react';
import {
  getOllamaStatus,
  startOllama as invokeStartOllama,
  getAvailableModels,
  pullModel as invokePullModel,
  swapModel as invokeSwapModel,
  OllamaStatus,
  ModelInfo,
  PullProgress,
  safeListen
} from '../lib/tauri';

export function useOllama() {
  const [status, setStatus] = useState<OllamaStatus>('NotInstalled');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const currentStatus = await getOllamaStatus();
      setStatus(currentStatus);
      if (currentStatus === 'Running') {
        const availableModels = await getAvailableModels();
        setModels(availableModels);
        setOllamaError(null);
      } else {
        setModels([]);
      }
    } catch (err) {
      console.error('Failed to refresh Ollama status:', err);
      setStatus('NotInstalled');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unlisten = safeListen<PullProgress>('pull-progress', (event) => {
      const progress = event.payload;
      const pStatus = progress.status || '';

      if (pStatus.toLowerCase().startsWith('error:')) {
        setOllamaError(pStatus.replace(/^error:\s*/i, ''));
        setIsPulling(false);
        setPullProgress(null);
        return;
      }

      setPullProgress(progress);
      setIsPulling(true);

      const { completed, total } = progress;
      if (pStatus === 'success' || (completed !== null && total !== null && total > 0 && completed >= total)) {
        setIsPulling(false);
        setPullProgress(null);
        setOllamaError(null);
        refresh();
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [refresh]);

  const startEngine = useCallback(async () => {
    setIsStarting(true);
    setOllamaError(null);
    try {
      await invokeStartOllama();
      await refresh();
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Failed to start Ollama';
      setOllamaError(msg);
      throw err;
    } finally {
      setIsStarting(false);
    }
  }, [refresh]);

  const pullModel = useCallback(async (modelName: string) => {
    setOllamaError(null);
    try {
      setIsPulling(true);
      setPullProgress({ status: `Initiating download of ${modelName}...`, completed: null, total: null });
      await invokePullModel(modelName);
    } catch (err: any) {
      console.error('Failed to pull model:', err);
      const msg = typeof err === 'string' ? err : err?.message || `Failed to pull ${modelName}`;
      setOllamaError(msg);
      setIsPulling(false);
      setPullProgress(null);
      throw err;
    }
  }, []);

  const swapModel = useCallback(async (modelName: string) => {
    try {
      await invokeSwapModel(modelName);
      await refresh();
    } catch (err) {
      console.error('Failed to swap model:', err);
      throw err;
    }
  }, [refresh]);

  return {
    status,
    models,
    pullModel,
    swapModel,
    startEngine,
    isStarting,
    ollamaError,
    refresh,
    pullProgress,
    isPulling,
  };
}
