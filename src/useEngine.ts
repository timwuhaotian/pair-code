import { useCallback, useRef, useState } from 'react';
import type { PairState, ToolEvent } from './types.js';
import { runPairEngine, runGreetingSession, killActiveTurn, type EngineCallbacks } from './process.js';

export interface EngineHook {
  state: PairState | null;
  liveText: string;
  liveTools: ToolEvent[];
  running: boolean;
  runTask: (state: PairState) => Promise<PairState>;
  runGreeting: (state: PairState) => Promise<PairState>;
  requestStop: () => void;
  setState: (state: PairState) => void;
}

export function useEngine(initial: PairState | null): EngineHook {
  const [state, setStateRaw] = useState<PairState | null>(initial);
  const [liveText, setLiveText] = useState('');
  const [liveTools, setLiveTools] = useState<ToolEvent[]>([]);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  // Stream deltas accumulate in a ref and are flushed to React state on a
  // timer, so a fast token stream can't trigger a re-render per token.
  const liveTextRef = useRef('');

  const setState = useCallback((s: PairState) => setStateRaw(s), []);

  // Shared callback builder so runTask and runGreeting stay in lockstep —
  // avoids drift in how streaming state is mirrored to React.
  const makeCallbacks = (): EngineCallbacks => ({
    onStateUpdate: (s) => setStateRaw(s),
    onLog: () => { /* logs are surfaced via activity; raw stderr not shown in main UI */ },
    onActivity: () => { /* state already reflects activity */ },
    onTextDelta: (_role, text) => { liveTextRef.current += text; },
    onToolStart: (_role, ev) => setLiveTools(prev => [...prev, ev]),
    onToolEnd: (_role, id, status) => setLiveTools(prev => prev.map(t => t.id === id ? { ...t, status } : t)),
    onMessage: (s) => { setStateRaw(s); liveTextRef.current = ''; setLiveText(''); setLiveTools([]); },
    onError: () => { /* captured into state.lastError */ },
    shouldStop: () => stopRef.current,
  });

  const runTask = useCallback(async (start: PairState): Promise<PairState> => {
    stopRef.current = false;
    setRunning(true);
    liveTextRef.current = '';
    setLiveText('');
    setLiveTools([]);

    const flush = setInterval(() => setLiveText(liveTextRef.current), 60);

    try {
      const final = await runPairEngine(start, makeCallbacks());
      return final;
    } finally {
      clearInterval(flush);
      liveTextRef.current = '';
      setLiveText('');
      setLiveTools([]);
      setRunning(false);
    }
  }, []);

  const runGreeting = useCallback(async (start: PairState): Promise<PairState> => {
    stopRef.current = false;
    setRunning(true);
    liveTextRef.current = '';
    setLiveText('');
    setLiveTools([]);

    const flush = setInterval(() => setLiveText(liveTextRef.current), 60);

    try {
      const final = await runGreetingSession(start, makeCallbacks());
      return final;
    } finally {
      clearInterval(flush);
      liveTextRef.current = '';
      setLiveText('');
      setLiveTools([]);
      setRunning(false);
    }
  }, []);

  const requestStop = useCallback(() => {
    stopRef.current = true;
    killActiveTurn();
  }, []);

  return { state, liveText, liveTools, running, runTask, runGreeting, requestStop, setState };
}
