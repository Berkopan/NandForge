import { CpuMachine, disassemble, type CpuState, type CpuSnapshot } from '../cpu';
import { appendSamples, probeId, type SignalProbe, type WaveformSample } from '../editor/waveforms';

export interface HistoryEntry { snapshot: CpuSnapshot; state: CpuState; label: string }
export interface ExecutionEntry { cycle: number; pc: number; instruction: string; changes: string[]; memoryChanges: number[] }
export type StopReason = 'breakpoint' | 'watchpoint' | 'halt' | 'fault' | 'limit' | null;
export const MAX_HISTORY = 256;
export const MAX_RUN_STEPS = 100000;

export const DEFAULT_CPU_PROBES: SignalProbe[] = [
  { id: probeId('clock', 'out'), nodeId: 'clock', pin: 'out', name: 'CLK', width: 1 },
  { id: probeId('registers', 'a'), nodeId: 'registers', pin: 'a', name: 'A', width: 8 },
  { id: probeId('pc', 'pc'), nodeId: 'pc', pin: 'pc', name: 'PC', width: 8 },
  { id: probeId('control', 'aWrite'), nodeId: 'control', pin: 'aWrite', name: 'A.write', width: 1 },
  { id: probeId('io', 'output'), nodeId: 'io', pin: 'output', name: 'OUT', width: 8 },
];

export class DebuggerSession {
  readonly machine = new CpuMachine();
  breakpoints = new Set<number>();
  watchpoints = new Set<number>();
  probes = structuredClone(DEFAULT_CPU_PROBES);
  samples: WaveformSample[] = [];
  recording = true;
  history: HistoryEntry[] = [];
  historyIndex = 0;
  log: ExecutionEntry[] = [];
  stopReason: StopReason = null;
  private sampleIndex = 0;
  private runSteps = 0;
  private bypassBreakpoint = false;

  constructor() { this.resetHistory(); }
  get state(): CpuState { return this.machine.state; }

  load(rom: readonly number[], ram: readonly number[] = []): void {
    this.machine.load(rom, ram);
    this.breakpoints.clear(); this.watchpoints.clear();
    this.resetHistory();
  }

  reset(): void { this.machine.reset(); this.resetHistory(); }

  private resetHistory(): void {
    this.history = [{ snapshot: this.machine.snapshot(), state: this.state, label: 'Reset' }];
    this.historyIndex = 0; this.samples = []; this.sampleIndex = 0; this.log = [];
    this.stopReason = null; this.runSteps = 0; this.bypassBreakpoint = false;
    this.capture('initial');
  }

  capture(phase: WaveformSample['phase']): void {
    if (!this.recording) return;
    const values: Record<string, number> = {};
    for (const probe of this.probes) values[probe.id] = this.machine.simulator.read(probe.nodeId, probe.pin);
    this.samples = appendSamples(this.samples, [{ index: this.sampleIndex++, cycle: this.machine.simulator.cycle, phase, values }]);
  }

  clearCapture(): void { this.samples = []; this.sampleIndex = 0; this.capture('initial'); }
  addProbe(probe: SignalProbe): void {
    if (this.probes.some((p) => p.id === probe.id) || this.probes.length >= 24) return;
    this.machine.simulator.read(probe.nodeId, probe.pin);
    this.probes.push(probe); this.capture('input');
  }
  removeProbe(id: string): void { this.probes = this.probes.filter((p) => p.id !== id); }

  private truncateFuture(): void {
    if (this.historyIndex === this.history.length - 1) return;
    const cycle = this.state.cycles;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.samples = this.samples.filter((sample) => sample.cycle <= cycle);
    this.log = this.log.filter((entry) => entry.cycle <= cycle);
  }

  setInput(value: number): void {
    this.machine.setInput(value); this.truncateFuture();
    this.history[this.historyIndex] = { snapshot: this.machine.snapshot(), state: this.state, label: `IN = ${value}` };
    this.stopReason = null; this.capture('input');
  }

  restore(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.history.length) return;
    this.historyIndex = index; this.machine.restore(this.history[index]!.snapshot); this.stopReason = null; this.bypassBreakpoint = false;
  }
  backward(): void { this.restore(this.historyIndex - 1); }
  forward(): void { this.restore(this.historyIndex + 1); }

  step(): StopReason {
    const before = this.state;
    if (before.halted || before.fault) { this.stopReason = before.fault ? 'fault' : 'halt'; return this.stopReason; }
    this.truncateFuture();
    this.machine.step((phase) => this.capture(phase));
    const after = this.state;
    const memoryChanges = after.ram.flatMap((value, index) => value !== before.ram[index] ? [index] : []);
    const changes: string[] = [];
    for (const key of ['a', 'pc', 'z', 'c', 'output'] as const) if (before[key] !== after[key]) changes.push(`${key.toUpperCase()} ${before[key]} → ${after[key]}`);
    for (const address of memoryChanges) changes.push(`RAM[${address}] ${before.ram[address]} → ${after.ram[address]}`);
    const instruction = disassemble(before.instruction);
    this.log = [...this.log.slice(-(MAX_HISTORY - 1)), { cycle: after.cycles, pc: before.pc, instruction, changes, memoryChanges }];
    this.history.push({ snapshot: this.machine.snapshot(), state: after, label: instruction });
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.stopReason = after.fault ? 'fault' : after.halted ? 'halt' : memoryChanges.some((address) => this.watchpoints.has(address)) ? 'watchpoint' : null;
    return this.stopReason;
  }

  beginRun(): void {
    this.bypassBreakpoint = this.stopReason === 'breakpoint';
    this.stopReason = null; this.runSteps = 0;
  }

  runSlice(budget = 1): StopReason {
    for (let count = 0; count < budget; count++) {
      if (this.breakpoints.has(this.state.pc) && !this.bypassBreakpoint) { this.stopReason = 'breakpoint'; return this.stopReason; }
      this.bypassBreakpoint = false;
      const reason = this.step();
      if (reason) return reason;
      this.runSteps++;
      if (this.runSteps >= MAX_RUN_STEPS) { this.stopReason = 'limit'; return this.stopReason; }
    }
    return null;
  }
}
