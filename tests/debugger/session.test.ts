import { describe, expect, it } from 'vitest';
import { assemble } from '../../src/assembler';
import { DebuggerSession, MAX_HISTORY } from '../../src/debugger/session';
import { MAX_WAVEFORM_SAMPLES, probeId, exportWaveformCapture } from '../../src/editor/waveforms';

function session(source: string): DebuggerSession {
  const assembled = assemble(source);
  expect(assembled.diagnostics).toEqual([]);
  const debug = new DebuggerSession();
  debug.load(assembled.rom);
  return debug;
}

describe('debugger execution and time travel', () => {
  it('stops before executing a breakpoint and resumes past that one stop', () => {
    const debug = session('LDI 3\nOUT\nHLT');
    debug.breakpoints.add(1);
    debug.beginRun();
    expect(debug.runSlice(20)).toBe('breakpoint');
    expect(debug.state).toMatchObject({ pc: 1, a: 3, output: 0, cycles: 1 });
    debug.beginRun();
    expect(debug.runSlice(20)).toBe('halt');
    expect(debug.state).toMatchObject({ pc: 2, output: 3, cycles: 3 });
  });

  it('hits a looping breakpoint again after resuming, without getting stuck at the same stop', () => {
    const debug = session('NOP\nJMP 0');
    debug.breakpoints.add(0);
    debug.beginRun();
    expect(debug.runSlice(20)).toBe('breakpoint');
    expect(debug.state.cycles).toBe(0);
    debug.beginRun();
    expect(debug.runSlice(20)).toBe('breakpoint');
    expect(debug.state.cycles).toBe(2);
  });

  it('single-steps through a breakpoint and stops after an observed RAM change', () => {
    const debug = session('LDI 23\nSTA 255\nOUT\nHLT');
    debug.breakpoints.add(0);
    debug.watchpoints.add(255);
    expect(debug.step()).toBe(null);
    expect(debug.step()).toBe('watchpoint');
    expect(debug.state).toMatchObject({ pc: 2, a: 23, output: 0 });
    expect(debug.state.ram[255]).toBe(23);
    expect(debug.log.at(-1)).toMatchObject({ cycle: 2, pc: 1, instruction: 'STA 255', memoryChanges: [255] });
  });

  it('resumes from a watchpoint to HALT and does not revive a halted machine or its stale watch stop', () => {
    const debug = session('LDI 23\nSTA 255\nHLT');
    debug.watchpoints.add(255);
    debug.beginRun();
    expect(debug.runSlice(20)).toBe('watchpoint');
    expect(debug.state).toMatchObject({ pc: 2, halted: false, cycles: 2 });
    debug.beginRun();
    expect(debug.runSlice(20)).toBe('halt');
    const halted = debug.machine.snapshot();
    const historyLength = debug.history.length;
    debug.beginRun();
    expect(debug.runSlice(20)).toBe('halt');
    expect(debug.step()).toBe('halt');
    expect(debug.machine.snapshot()).toEqual(halted);
    expect(debug.history).toHaveLength(historyLength);
    expect(debug.state.ram[255]).toBe(23);
  });

  it('restores RAM, flags, PC and output while navigating backward and forward', () => {
    const debug = session('LDI 128\nSHL\nSTA 255\nOUT\nHLT');
    const states = [debug.state];
    for (let i = 0; i < 5; i++) { debug.step(); states.push(debug.state); }
    for (let i = 4; i >= 0; i--) { debug.backward(); expect(debug.state).toEqual(states[i]); }
    for (let i = 1; i < states.length; i++) { debug.forward(); expect(debug.state).toEqual(states[i]); }
  });

  it('discards abandoned future states, logs and waveform events when execution branches after rewind', () => {
    const debug = session('IN\nOUT\nHLT');
    debug.setInput(7);
    debug.beginRun(); debug.runSlice(10);
    expect(debug.state.output).toBe(7);
    debug.restore(0);
    debug.setInput(19);
    expect(debug.history).toHaveLength(1);
    expect(debug.log).toEqual([]);
    expect(debug.samples.every((sample) => sample.cycle === 0)).toBe(true);
    debug.beginRun(); debug.runSlice(10);
    expect(debug.state.output).toBe(19);
    expect(debug.history.at(-1)?.state.output).toBe(19);
    debug.forward();
    expect(debug.state.output).toBe(19);
  });

  it('does not destroy the future history when an invalid input edit is rejected', () => {
    const debug = session('IN\nOUT\nHLT');
    debug.step(); debug.step();
    debug.backward();
    const history = structuredClone(debug.history);
    const snapshot = debug.machine.snapshot();
    expect(() => debug.setInput(256)).toThrow();
    expect(debug.history).toEqual(history);
    expect(debug.machine.snapshot()).toEqual(snapshot);
  });

  it('reset clears a pending one-shot breakpoint bypass', () => {
    const debug = session('NOP\nJMP 0');
    debug.breakpoints.add(0);
    debug.beginRun();
    expect(debug.runSlice()).toBe('breakpoint');
    debug.beginRun(); // queues the one-shot bypass, before the UI's next timer tick
    debug.reset();
    expect(debug.runSlice()).toBe('breakpoint');
    expect(debug.state.cycles).toBe(0);
  });

  it('bounds history, logs and waveforms while preserving the newest restorable state', () => {
    const debug = session('NOP\nJMP 0');
    for (let i = 0; i < 800; i++) debug.step();
    expect(debug.history).toHaveLength(MAX_HISTORY);
    expect(debug.log).toHaveLength(MAX_HISTORY);
    expect(debug.samples).toHaveLength(MAX_WAVEFORM_SAMPLES);
    expect(debug.historyIndex).toBe(MAX_HISTORY - 1);
    debug.backward();
    expect(debug.state.cycles).toBe(799);
    debug.forward();
    expect(debug.state.cycles).toBe(800);
  });

  it('captures actual clock edges and latch values, then exports a documented trace', () => {
    const debug = session('LDI 11\nOUT\nHLT');
    debug.step(); debug.step();
    const clock = probeId('clock', 'out');
    const accumulator = probeId('registers', 'a');
    expect(debug.samples.map(({ phase, values }) => [phase, values[clock]])).toEqual([
      ['initial', 0], ['rising', 1], ['falling', 0], ['rising', 1], ['falling', 0],
    ]);
    expect(debug.samples[0]?.values[accumulator]).toBe(0);
    expect(debug.samples.slice(1).every(({ values }) => values[accumulator] === 11)).toBe(true);
    const exported = JSON.parse(exportWaveformCapture(debug.probes, debug.samples)) as { format: string; samples: unknown[]; signals: unknown[] };
    expect(exported.format).toBe('nandforge-waveform');
    expect(exported.samples).toEqual(debug.samples);
    expect(exported.signals).toEqual(debug.probes);
  });

  it('honors recording controls and prevents duplicate probes', () => {
    const debug = session('LDI 11\nHLT');
    const count = debug.probes.length;
    debug.addProbe(debug.probes[0]!);
    expect(debug.probes).toHaveLength(count);
    debug.recording = false;
    debug.step();
    expect(debug.samples).toHaveLength(1);
    debug.recording = true;
    debug.clearCapture();
    expect(debug.samples).toHaveLength(1);
    expect(debug.samples[0]?.cycle).toBe(1);
  });

  it('distinguishes processor faults from ordinary halt stops', () => {
    const debug = session('.WORD 0x9900');
    debug.beginRun();
    expect(debug.runSlice(5)).toBe('fault');
    expect(debug.state).toMatchObject({ fault: true, halted: true, pc: 0, cycles: 1 });
  });
});
