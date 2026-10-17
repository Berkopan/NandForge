import { cpus, arch, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { CircuitBuilder, compileCircuit, createTemplate, Simulator } from '../src/core';
import type { Circuit, Endpoint } from '../src/core';
import { CpuMachine, buildCpuCircuit } from '../src/cpu';
import { assemble } from '../src/assembler';
import { DebuggerSession, MAX_HISTORY } from '../src/debugger/session';
import { MAX_WAVEFORM_SAMPLES } from '../src/editor/waveforms';

/** Reproducible local CPU workloads, not browser frame-rate claims. */
const repetitions = 3;
const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const round = (value: number) => Math.round(value * 1000) / 1000;
const elapsed = (fn: () => void): number => { const start = performance.now(); fn(); return performance.now() - start; };

function layeredNands(columns: number, rows: number): Circuit {
  const builder = new CircuitBuilder(`bench-${columns * rows}`, `${columns * rows} layered NAND gates`);
  const source = builder.input('word', 16);
  const splitter = builder.gate('SPLIT', { in: source }, 16).node;
  let previous: Endpoint[] = Array.from({ length: rows }, (_, row) => ({ node: splitter, pin: `b${row % 16}` }));
  for (let column = 0; column < columns; column++) {
    const next: Endpoint[] = [];
    for (let row = 0; row < rows; row++) {
      const id = `nand-${column.toString().padStart(3, '0')}-${row.toString().padStart(3, '0')}`;
      builder.add('NAND', id, { width: 1 });
      builder.wire(previous[row]!, { node: id, pin: 'a' });
      builder.wire(previous[(row * 7 + column + 3) % rows]!, { node: id, pin: 'b' });
      next.push({ node: id, pin: 'out' });
    }
    previous = next;
  }
  previous.forEach((from, index) => builder.output(`probe-${index}`, 1, from));
  return builder.circuit;
}

interface Result {
  name: string;
  gates: number;
  operations: number;
  sequential: number;
  depth: number;
  iterations: number;
  compileMs: number;
  medianMs: number;
  iterationsPerSecond: number;
  samplesMs: number[];
  details?: Record<string, number | string>;
}

function combinational(name: string, circuit: Circuit, iterations: number, set: (simulator: Simulator, index: number) => void): Result {
  // Warm transformation and library blueprints before timing repeatable compilation.
  compileCircuit(circuit);
  const compileSamples = Array.from({ length: repetitions }, () => elapsed(() => { compileCircuit(circuit); }));
  const compiled = compileCircuit(circuit);
  const samples = Array.from({ length: repetitions }, () => {
    const simulator = new Simulator(compiled);
    for (let index = 0; index < 500; index++) set(simulator, index);
    return elapsed(() => { for (let index = 0; index < iterations; index++) set(simulator, index); });
  });
  const ms = median(samples);
  return { name, gates: compiled.stats.gates, operations: compiled.operations.length, sequential: compiled.stats.sequential, depth: compiled.stats.depth,
    iterations, compileMs: round(median(compileSamples)), medianMs: round(ms), iterationsPerSecond: Math.round(iterations / ms * 1000), samplesMs: samples.map(round) };
}

const results: Result[] = [];
results.push(combinational('Small · four-NAND XOR', createTemplate('nand-xor'), 50_000, (simulator, index) => simulator.setInputs({ 'in-a': index & 1, 'in-b': (index >>> 1) & 1 })));
results.push(combinational('Medium · 512 NAND gates', layeredNands(16, 32), 10_000, (simulator, index) => simulator.setInput('in-word', (index + 1) & 65535)));
results.push(combinational('Large · 8,192 NAND gates', layeredNands(64, 128), 1_000, (simulator, index) => simulator.setInput('in-word', (index + 1) & 65535)));

const program = assemble('LDI 1\nSTA 240\nLDI 0\nloop: ADD 240\nOUT\nJMP loop');
if (!program.ok) throw new Error('Benchmark program did not assemble.');
const architecture = buildCpuCircuit();
const compiledCpu = compileCircuit(architecture.circuit, architecture.chips);
const compileCpu = Array.from({ length: repetitions }, () => elapsed(() => { compileCircuit(architecture.circuit, architecture.chips); }));

const cpuIterations = 12_003;
const cpuSamples = Array.from({ length: repetitions }, () => {
  const cpu = new CpuMachine();
  cpu.load(program.rom);
  for (let index = 0; index < 300; index++) cpu.step();
  cpu.reset();
  const ms = elapsed(() => { for (let index = 0; index < cpuIterations; index++) cpu.step(); });
  if (cpu.state.output !== 160 || cpu.state.cycles !== cpuIterations || cpu.state.fault) throw new Error('CPU benchmark diverged from the expected 4,000-increment output.');
  return ms;
});
results.push({ name: 'Gate CPU · execution and state reads', gates: compiledCpu.stats.gates, operations: compiledCpu.operations.length, sequential: compiledCpu.stats.sequential,
  depth: compiledCpu.stats.depth, iterations: cpuIterations, compileMs: round(median(compileCpu)), medianMs: round(median(cpuSamples)),
  iterationsPerSecond: Math.round(cpuIterations / median(cpuSamples) * 1000), samplesMs: cpuSamples.map(round), details: { finalOutput: 160, loopIncrements: 4000 } });

const debuggerIterations = 5_000;
let retainedBytes = 0;
const debuggerSamples = Array.from({ length: repetitions }, () => {
  const session = new DebuggerSession();
  session.load(program.rom);
  const ms = elapsed(() => { for (let index = 0; index < debuggerIterations; index++) session.step(); });
  if (session.samples.length !== MAX_WAVEFORM_SAMPLES || session.history.length !== MAX_HISTORY || session.state.cycles !== debuggerIterations) throw new Error('Debugger retention bounds or executed cycle count failed.');
  const clock = session.probes.find(probe => probe.nodeId === 'clock')!;
  const levels = new Set(session.samples.map(sample => sample.values[clock.id]));
  if (!levels.has(0) || !levels.has(1)) throw new Error('Waveform benchmark did not capture real clock edges.');
  retainedBytes = Buffer.byteLength(JSON.stringify({ history: session.history, samples: session.samples, log: session.log }), 'utf8');
  const final = session.machine.snapshot();
  session.backward(); session.forward();
  if (JSON.stringify(session.machine.snapshot()) !== JSON.stringify(final)) throw new Error('Debugger history failed deterministic restoration.');
  return ms;
});
results.push({ name: 'Debugger · CPU, five probes, bounded history', gates: compiledCpu.stats.gates, operations: compiledCpu.operations.length, sequential: compiledCpu.stats.sequential,
  depth: compiledCpu.stats.depth, iterations: debuggerIterations, compileMs: 0, medianMs: round(median(debuggerSamples)),
  iterationsPerSecond: Math.round(debuggerIterations / median(debuggerSamples) * 1000), samplesMs: debuggerSamples.map(round),
  details: { probes: 5, retainedSamples: MAX_WAVEFORM_SAMPLES, retainedSnapshots: MAX_HISTORY, retainedSerializedBytes: retainedBytes } });

console.log(JSON.stringify({
  benchmark: 'NandForge deterministic synchronous simulation', measuredAt: new Date().toISOString(), repetitions,
  environment: { node: process.version, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length },
  notes: [
    'Times are local Node wall-clock measurements, medians of three samples; no browser FPS guarantee is implied.',
    'NAND gate count sums bus width; operation count counts word-level NAND, split/join, and memory operations.',
    'Compile times use warmed module blueprints and exclude simulator allocation; runtime excludes initial loading.',
    'The debugger workload includes CPU state copies, two actual phase samples per cycle, RAM change detection, logging and snapshots.',
    'Retained serialized bytes is JSON payload size, not JavaScript heap usage. Compilation has no independent step in the debugger workload.',
  ], results,
}, null, 2));
