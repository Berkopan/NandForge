import { describe, expect, it } from 'vitest';
import { compileCircuit, createTemplate, Simulator } from '../../src/core';
import { appendSamples, exportWaveformCapture, MAX_WAVEFORM_SAMPLES, probeId, waveformSegments, type SignalProbe, type WaveformSample } from '../../src/editor/waveforms';

describe('waveform capture reflects actual observed simulation states', () => {
  it('records the clock edge, latched register, and actual enable signal', () => {
    const simulator = new Simulator(compileCircuit(createTemplate('register8')));
    const probes: SignalProbe[] = [
      { id: 'clk', nodeId: 'clock', pin: 'out', name: 'CLK', width: 1 },
      { id: 'q', nodeId: 'gate', pin: 'q', name: 'Register', width: 8 },
      { id: 'en', nodeId: 'in-en', pin: 'out', name: 'Enable', width: 1 },
    ];
    let samples: WaveformSample[] = [];
    const capture = () => simulator.step((phase, sim) => {
      samples = appendSamples(samples, [{ index: samples.length, cycle: sim.cycle, phase, values: Object.fromEntries(probes.map(probe => [probe.id, sim.read(probe.nodeId, probe.pin)])) }]);
    });
    simulator.setInput('in-d', 7);
    expect(simulator.read('gate', 'q')).toBe(0);
    capture();
    simulator.setInput('in-d', 123);
    simulator.setInput('in-en', 0);
    capture();
    expect(samples.map(sample => sample.values.clk)).toEqual([1, 0, 1, 0]);
    expect(samples.map(sample => sample.values.q)).toEqual([7, 7, 7, 7]);
    expect(samples.map(sample => sample.values.en)).toEqual([1, 1, 0, 0]);
    expect(samples.map(sample => sample.phase)).toEqual(['rising', 'falling', 'rising', 'falling']);
    const exported = JSON.parse(exportWaveformCapture(probes, samples)) as { format: string; version: number; signals: SignalProbe[]; samples: WaveformSample[] };
    expect(exported.format).toBe('nandforge-waveform');
    expect(exported.version).toBe(1);
    expect(exported.signals).toEqual(probes);
    expect(exported.samples).toEqual(samples);
  });

  it('evicts oldest samples while preserving indices and handles oversize batches', () => {
    const incoming = Array.from({ length: 3000 }, (_, index): WaveformSample => ({ index, cycle: index, phase: 'input', values: { a: index % 2 } }));
    let samples: WaveformSample[] = [];
    for (const sample of incoming) samples = appendSamples(samples, [sample]);
    expect(samples).toHaveLength(MAX_WAVEFORM_SAMPLES);
    expect(samples[0]!.index).toBe(3000 - MAX_WAVEFORM_SAMPLES);
    expect(samples.at(-1)!.index).toBe(2999);
    expect(appendSamples([], incoming)).toEqual(samples);
  });

  it('keeps missing earlier probes visibly distinct from measured zero values', () => {
    const samples: WaveformSample[] = [
      { index: 0, cycle: 0, phase: 'initial', values: {} },
      { index: 1, cycle: 0, phase: 'input', values: { late: 0 } },
      { index: 2, cycle: 1, phase: 'rising', values: { late: 0 } },
      { index: 3, cycle: 1, phase: 'falling', values: { late: 1 } },
    ];
    expect(waveformSegments(samples, 'late')).toEqual([{ start: 0, end: 1, value: undefined }, { start: 1, end: 3, value: 0 }, { start: 3, end: 4, value: 1 }]);
    expect(probeId('a:b', 'c')).not.toBe(probeId('a', 'b:c'));
  });
});
