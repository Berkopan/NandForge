import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircuitError, compileCircuit, Simulator } from '../core';
import type { ChipDefinition, Circuit, CircuitStats, Diagnostic } from '../core/types';
import { appendSamples, type SamplePhase, type SignalProbe, type WaveformSample } from './waveforms';
import { readScopedSignal } from './model';

function withoutLayout(circuit: Circuit): Circuit {
  return { ...circuit, components: circuit.components.map(component => ({ ...component, position: { x: 0, y: 0 } })) };
}

interface Execution {
  simulator: Simulator | null;
  diagnostics: Diagnostic[];
  stats: CircuitStats | null;
}

/** Layout changes do not recompile the circuit or erase clocked state. */
export function useCircuitRuntime(circuit: Circuit, chips: ChipDefinition[], probes: SignalProbe[], onRunLimit: () => void, externalSimulator?: Simulator, signalPrefix = '', externalRevision = 0) {
  const key = useMemo(() => externalSimulator && !signalPrefix ? '' : JSON.stringify({ circuit: withoutLayout(circuit), chips: chips.map(chip => ({ ...chip, circuit: withoutLayout(chip.circuit) })) }), [circuit, chips, externalSimulator, signalPrefix]);
  const execution = useMemo<Execution>(() => {
    if (externalSimulator && !signalPrefix) return { simulator: externalSimulator, diagnostics: [...externalSimulator.compiled.diagnostics], stats: externalSimulator.compiled.stats };
    const definition = JSON.parse(key) as { circuit: Circuit; chips: ChipDefinition[] };
    try {
      const compiled = compileCircuit(definition.circuit, definition.chips);
      if (externalSimulator) return { simulator: externalSimulator, diagnostics: [...compiled.diagnostics], stats: compiled.stats };
      const simulator = new Simulator(compiled);
      simulator.evaluate();
      return { simulator, diagnostics: [...compiled.diagnostics], stats: compiled.stats };
    } catch (error) {
      return { simulator: null, stats: null, diagnostics: error instanceof CircuitError ? error.diagnostics : [{ code: 'EDITOR_COMPILE', message: error instanceof Error ? error.message : String(error), severity: 'error' }] };
    }
  }, [key, externalSimulator, signalPrefix]);
  const [revision, setRevision] = useState(0);
  const [running, setRunningState] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [recording, setRecording] = useState(true);
  const [samples, setSamples] = useState<WaveformSample[]>([]);
  const sampleSequence = useRef(0);
  const runSteps = useRef(0);
  const cancelClock = useRef<(() => void) | null>(null);
  const requestedRunning = useRef(false);
  const setRunning = useCallback((next: boolean) => {
    // Stop queued ticks before callers reset state, inspect, or pause. Waiting for
    // React's passive effect cleanup would allow an extra clock edge in between.
    requestedRunning.current = next;
    if (!next) {
      cancelClock.current?.();
      cancelClock.current = null;
    }
    setRunningState(next);
  }, []);

  const makeSample = useCallback((simulator: Simulator, phase: SamplePhase, activeProbes = probes): WaveformSample => {
    const values: Record<string, number> = {};
    for (const probe of activeProbes) {
      const value = readScopedSignal(simulator, signalPrefix, probe.nodeId, probe.pin);
      if (value !== undefined) values[probe.id] = value;
    }
    return { index: sampleSequence.current++, cycle: simulator.cycle, phase, values };
  }, [probes, signalPrefix]);

  const capture = useCallback((phase: SamplePhase = 'input', activeProbes = probes) => {
    if (!execution.simulator || !recording || activeProbes.length === 0) return;
    const next = makeSample(execution.simulator, phase, activeProbes);
    setSamples(previous => appendSamples(previous, [next]));
  }, [execution, recording, probes, makeSample]);

  useEffect(() => {
    setRunning(false);
    setSamples([]);
    sampleSequence.current = 0;
    runSteps.current = 0;
  }, [execution, setRunning]);

  // Externally owned machines may change through their debugger. Observe their real
  // settled state; the owning debugger retains the per-edge high/low capture.
  const observedExternal = useRef<{ simulator: Simulator | undefined; revision: number; cycle: number }>({ simulator: undefined, revision: -1, cycle: -1 });
  useEffect(() => {
    if (!externalSimulator) return;
    if (observedExternal.current.simulator === externalSimulator && observedExternal.current.revision === externalRevision) return;
    const phase: SamplePhase = observedExternal.current.simulator !== externalSimulator ? 'initial' : observedExternal.current.cycle === externalSimulator.cycle ? 'input' : 'falling';
    observedExternal.current = { simulator: externalSimulator, revision: externalRevision, cycle: externalSimulator.cycle };
    capture(phase);
  }, [externalSimulator, externalRevision, capture]);

  const step = useCallback(() => {
    if (!execution.simulator || externalSimulator) return;
    const incoming: WaveformSample[] = [];
    execution.simulator.step((phase, simulator) => {
      if (recording && probes.length > 0) incoming.push(makeSample(simulator, phase));
    });
    if (incoming.length) setSamples(previous => appendSamples(previous, incoming));
    setRevision(value => value + 1);
  }, [execution, recording, probes, makeSample, externalSimulator]);

  useEffect(() => {
    if (!running || !requestedRunning.current || !execution.simulator || externalSimulator) return;
    let stopped = false;
    const interval = window.setInterval(() => {
      if (stopped || !requestedRunning.current) return;
      if (runSteps.current >= 10000) {
        setRunning(false);
        runSteps.current = 0;
        onRunLimit();
        return;
      }
      step();
      runSteps.current += 1;
    }, 1000 / speed);
    const cancel = () => { stopped = true; window.clearInterval(interval); };
    cancelClock.current = cancel;
    return () => {
      cancel();
      if (cancelClock.current === cancel) cancelClock.current = null;
    };
  }, [running, execution, speed, step, onRunLimit, externalSimulator, setRunning]);

  const setInput = useCallback((nodeId: string, value: number) => {
    if (!execution.simulator || externalSimulator) return;
    execution.simulator.setInput(nodeId, value);
    execution.simulator.evaluate();
    capture('input');
    setRevision(current => current + 1);
  }, [execution, capture, externalSimulator]);

  const reset = useCallback(() => {
    setRunning(false);
    if (!externalSimulator) execution.simulator?.reset();
    sampleSequence.current = 0;
    runSteps.current = 0;
    setSamples([]);
    setRevision(current => current + 1);
  }, [execution, externalSimulator, setRunning]);

  const read = useCallback((nodeId: string, pin: string): number | undefined => {
    return readScopedSignal(execution.simulator, signalPrefix, nodeId, pin);
  }, [execution, signalPrefix]);

  const clearCapture = useCallback(() => { setSamples([]); sampleSequence.current = 0; }, []);

  return { ...execution, revision, running, setRunning, speed, setSpeed, recording, setRecording, samples, clearCapture, capture, step, setInput, reset, read };
}
