import { useState, useEffect, useCallback } from 'react';

import {
  safeListen,
  getPairingState,
  initiatePairing as invokeInitiatePairing,
  confirmPairing as invokeConfirmPairing,
  generatePairingCode as invokeGenerateCode,
  submitPairingCode as invokeSubmitCode,
  generatePairingLink as invokeGenerateLink,
  connectToUrl as invokeConnectToUrl,
  PairingState
} from '../lib/tauri';

export function usePairing() {
  const [state, setState] = useState<PairingState>('Idle');

  useEffect(() => {
    let intervalId: number;
    let unlisten: any;

    const checkState = async () => {
      try {
        const currentState = await getPairingState();
        setState(currentState);
      } catch (err) {
        console.error('Failed to get pairing state:', err);
      }
    };

    safeListen('pairing-state-changed', () => {
      checkState();
    }).then((un) => {
      unlisten = un;
    }).catch(console.error);

    const isPolling = state === 'Discovering' || (typeof state === 'object' && 'AwaitingConfirmation' in state);
    if (isPolling) {
      intervalId = window.setInterval(checkState, 2000);
    }

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      if (unlisten) unlisten();
    };
  }, [state]);

  const initiatePairing = useCallback(async (peerId: string) => {
    setState('Discovering');
    try {
      await invokeInitiatePairing(peerId);
      const updated = await getPairingState();
      setState(updated);
    } catch (err: any) {
      console.error('[Vant Debug] Initiate pairing failed:', err);
      setState({ Failed: { reason: typeof err === 'string' ? err : err?.message || 'Pairing failed' } });
      throw err;
    }
  }, []);

  const confirmPairing = useCallback(async (confirmed: boolean) => {
    try {
      await invokeConfirmPairing(confirmed);
      const updated = await getPairingState();
      setState(updated);
    } catch (err: any) {
      console.error('[Vant Debug] Confirm pairing failed:', err);
    }
  }, []);

  const generateCode = useCallback(async () => {
    const code = await invokeGenerateCode();
    return code;
  }, []);

  const submitCode = useCallback(async (code: string) => {
    setState('Discovering');
    try {
      await invokeSubmitCode(code);
      const updated = await getPairingState();
      setState(updated);
    } catch (err: any) {
      console.error('[Vant Debug] Submit code failed:', err);
      setState({ Failed: { reason: typeof err === 'string' ? err : err?.message || 'Invalid code' } });
      throw err;
    }
  }, []);

  const generateLink = useCallback(async () => {
    const link = await invokeGenerateLink();
    return link;
  }, []);

  const connectToUrl = useCallback(async (url: string) => {
    const cleanUrl = url.trim().replace(/^['"`\\]+|['"`\\]+$/g, '');
    console.log('[Vant Debug] Attempting connection to host:', cleanUrl);
    setState('Discovering');
    try {
      await invokeConnectToUrl(cleanUrl);
      console.log('[Vant Debug] Connected successfully to host:', cleanUrl);
      const updated = await getPairingState();
      setState(updated);
    } catch (err: any) {
      console.error('[Vant Debug] Connection failed with error:', err);
      setState({ Failed: { reason: typeof err === 'string' ? err : err?.message || 'Connection failed' } });
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    setState('Idle');
  }, []);

  return {
    state,
    initiatePairing,
    confirmPairing,
    generateCode,
    submitCode,
    connectToUrl,
    generateLink,
    reset
  };
}
