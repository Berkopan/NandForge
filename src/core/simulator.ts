import type { CompiledCircuit, CompiledMemory, CompiledSource } from './compiler';
import { maskForWidth, word } from './numeric';

export interface SimulatorSnapshot {
  version: 1;
  circuitId: string;
  fingerprint: string;
  cycle: number;
  inputs: Record<string, number>;
  state: Record<string, number>;
  memories: Record<string, number[]>;
  clocks: Record<string, number>;
  clockLevels: Record<string, number>;
}
export type ClockPhase = 'rising' | 'falling';
export type ClockObserver = (phase: ClockPhase, simulator: Simulator) => void;

/** Pure synchronous digital simulation. No React, timers, browser state, or CPU opcode execution. */
export class Simulator {
  readonly compiled: CompiledCircuit;
  private readonly signals: Uint32Array;
  private readonly memory: Uint32Array[];
  private readonly inputById: Map<string, CompiledSource>;
  private readonly clockById: Map<string, CompiledSource>;
  private readonly memoryById: Map<string, { definition: CompiledMemory; index: number }>;
  private readonly nextState: Uint32Array;
  private readonly previousStateClocks: Uint8Array;
  private readonly pendingMemoryAddress: Uint32Array;
  private readonly pendingMemoryData: Uint32Array;
  private readonly pendingMemoryWrite: Uint8Array;
  private readonly previousMemoryClocks: Uint8Array;
  private dirty = true;
  private currentCycle = 0;

  constructor(compiled: CompiledCircuit) {
    this.compiled = compiled;
    this.signals = new Uint32Array(compiled.signalCount);
    this.memory = compiled.memories.map(memory => new Uint32Array(2 ** memory.addressWidth));
    this.inputById = new Map(compiled.inputs.map(input => [input.id, input]));
    this.clockById = new Map(compiled.clocks.map(clock => [clock.id, clock]));
    this.memoryById = new Map(compiled.memories.map((definition, index) => [definition.id, { definition, index }]));
    this.nextState = new Uint32Array(compiled.states.length);
    this.previousStateClocks = new Uint8Array(compiled.states.length);
    this.pendingMemoryAddress = new Uint32Array(compiled.memories.length);
    this.pendingMemoryData = new Uint32Array(compiled.memories.length);
    this.pendingMemoryWrite = new Uint8Array(compiled.memories.length);
    this.previousMemoryClocks = new Uint8Array(compiled.memories.length);
    this.reset();
  }

  get cycle(): number { return this.currentCycle; }

  /** Evaluate each operation once in stable topological order; unchanged input reads do no work. */
  evaluate(): void {
    if (!this.dirty) return;
    const signals = this.signals;
    for (const operation of this.compiled.operations) {
      switch (operation.kind) {
        case 'NAND':
          signals[operation.outputs[0]!] = ~(signals[operation.inputs[0]!]! & signals[operation.inputs[1]!]!) & ((1 << operation.width) - 1);
          break;
        case 'SPLIT': {
          const input = signals[operation.inputs[0]!]!;
          for (let bit = 0; bit < operation.width; bit++) signals[operation.outputs[bit]!] = (input >>> bit) & 1;
          break;
        }
        case 'JOIN': {
          let value = 0;
          for (let bit = 0; bit < operation.width; bit++) value |= signals[operation.inputs[bit]!]! << bit;
          signals[operation.outputs[0]!] = value;
          break;
        }
        case 'ROM': case 'RAM':
          signals[operation.outputs[0]!] = this.memory[operation.memory]![signals[operation.inputs[0]!]!]!;
          break;
      }
    }
    this.dirty = false;
  }

  setInput(nodeId: string, value: number): void {
    const input = this.inputById.get(nodeId);
    if (!input) throw new RangeError(`“${nodeId}” is not a top-level input.`);
    const normalized = word(value, input.width);
    if (this.signals[input.signal] !== normalized) { this.signals[input.signal] = normalized; this.dirty = true; }
    this.evaluate();
  }

  /** Apply a group of input changes together and recompute combinational logic only once. */
  setInputs(values: Readonly<Record<string, number>>): void {
    const assignments = Object.entries(values).map(([id, value]) => {
      const input = this.inputById.get(id);
      if (!input) throw new RangeError(`“${id}” is not a top-level input.`);
      return { input, value: word(value, input.width) };
    });
    for (const { input, value } of assignments) {
      if (this.signals[input.signal] !== value) { this.signals[input.signal] = value; this.dirty = true; }
    }
    this.evaluate();
  }

  read(nodeId: string, pin: string): number {
    const index = this.compiled.references.get(nodeId)?.get(pin);
    if (index === undefined) throw new RangeError(`No readable pin ${nodeId}.${pin}.`);
    this.evaluate();
    return this.signals[index]!;
  }

  /**
   * Sample data BEFORE a source-clock transition, then commit every detected positive edge
   * as one batch. This also handles an inverted/gated clock on the source's falling phase.
   */
  private transitionClocks(changes: readonly { signal: number; value: number }[]): void {
    if (changes.every(change => this.signals[change.signal] === change.value)) return;
    this.evaluate();
    const { states, memories } = this.compiled;
    for (let index = 0; index < states.length; index++) {
      const state = states[index]!;
      this.nextState[index] = this.signals[state.d]!;
      this.previousStateClocks[index] = this.signals[state.clk]!;
    }
    for (let index = 0; index < memories.length; index++) {
      const definition = memories[index]!;
      if (definition.kind !== 'RAM') continue;
      this.pendingMemoryAddress[index] = this.signals[definition.addr]!;
      this.pendingMemoryData[index] = this.signals[definition.d]!;
      this.pendingMemoryWrite[index] = this.signals[definition.we]!;
      this.previousMemoryClocks[index] = this.signals[definition.clk]!;
    }
    for (const change of changes) this.signals[change.signal] = change.value;
    this.dirty = true;
    this.evaluate();
    // Detect all edges before changing any state; data/addresses also came from one snapshot.
    const stateEdges: number[] = [];
    const memoryEdges: number[] = [];
    for (let index = 0; index < states.length; index++) {
      if (this.previousStateClocks[index] === 0 && this.signals[states[index]!.clk] === 1) stateEdges.push(index);
    }
    for (let index = 0; index < memories.length; index++) {
      const definition = memories[index]!;
      if (definition.kind === 'RAM' && this.previousMemoryClocks[index] === 0 && this.signals[definition.clk] === 1 && this.pendingMemoryWrite[index] === 1) memoryEdges.push(index);
    }
    for (const index of stateEdges) this.signals[states[index]!.q] = this.nextState[index]!;
    for (const index of memoryEdges) this.memory[index]![this.pendingMemoryAddress[index]!] = this.pendingMemoryData[index]!;
    if (stateEdges.length || memoryEdges.length) { this.dirty = true; this.evaluate(); }
  }

  /** Explicit half-clock control, useful for real phase-by-phase observations. Does not add a cycle. */
  setClock(nodeId: string, value: 0 | 1): void {
    const clock = this.clockById.get(nodeId);
    if (!clock) throw new RangeError(`“${nodeId}” is not a CLOCK component.`);
    if (value !== 0 && value !== 1) throw new RangeError('Clock level must be zero or one.');
    this.transitionClocks([{ signal: clock.signal, value }]);
  }

  /** One complete low → high → low pulse across all source clocks. */
  step(observer?: ClockObserver): void {
    if (this.currentCycle >= Number.MAX_SAFE_INTEGER) throw new RangeError('Simulation cycle counter overflow. Reset before continuing.');
    this.transitionClocks(this.compiled.clocks.map(clock => ({ signal: clock.signal, value: 0 })));
    this.currentCycle++;
    this.transitionClocks(this.compiled.clocks.map(clock => ({ signal: clock.signal, value: 1 })));
    try { observer?.('rising', this); }
    finally { this.transitionClocks(this.compiled.clocks.map(clock => ({ signal: clock.signal, value: 0 }))); }
    observer?.('falling', this);
  }

  getMemory(nodeId: string): number[] {
    const memory = this.memoryById.get(nodeId);
    if (!memory) throw new RangeError(`“${nodeId}” is not a RAM or ROM primitive.`);
    return Array.from(this.memory[memory.index]!);
  }

  setMemory(nodeId: string, contents: readonly number[]): void {
    const memory = this.memoryById.get(nodeId);
    if (!memory) throw new RangeError(`“${nodeId}” is not a RAM or ROM primitive.`);
    const target = this.memory[memory.index]!;
    const mask = maskForWidth(memory.definition.width);
    if (!Array.isArray(contents) || contents.length > target.length || contents.some(value => !Number.isInteger(value) || value < 0 || value > mask)) {
      throw new RangeError(`Memory contents must contain at most ${target.length} unsigned ${memory.definition.width}-bit words.`);
    }
    target.fill(0);
    target.set(contents);
    this.dirty = true;
    this.evaluate();
  }

  reset(): void {
    this.signals.fill(0);
    this.currentCycle = 0;
    for (const source of [...this.compiled.inputs, ...this.compiled.constants, ...this.compiled.clocks]) this.signals[source.signal] = source.initial;
    for (const state of this.compiled.states) this.signals[state.q] = state.initial;
    this.compiled.memories.forEach((definition, index) => {
      const memory = this.memory[index]!;
      memory.fill(0);
      memory.set(definition.initial);
    });
    this.dirty = true;
    this.evaluate();
  }

  snapshot(): SimulatorSnapshot {
    this.evaluate();
    return {
      version: 1, circuitId: this.compiled.id, fingerprint: this.compiled.fingerprint, cycle: this.currentCycle,
      inputs: Object.fromEntries(this.compiled.inputs.map(input => [input.id, this.signals[input.signal]!])),
      state: Object.fromEntries(this.compiled.states.map(state => [state.id, this.signals[state.q]!])),
      memories: Object.fromEntries(this.compiled.memories.map((memory, index) => [memory.id, Array.from(this.memory[index]!)])),
      clocks: Object.fromEntries(this.compiled.clocks.map(clock => [clock.id, this.signals[clock.signal]!])),
      clockLevels: Object.fromEntries([
        ...this.compiled.states.map(state => [state.id, this.signals[state.clk]!] as const),
        ...this.compiled.memories.filter(memory => memory.kind === 'RAM').map(memory => [memory.id, this.signals[memory.clk]!] as const),
      ]),
    };
  }

  /** Validate everything before mutation. Snapshots from changed circuitry are deliberately rejected. */
  restore(snapshot: SimulatorSnapshot): void {
    if (!snapshot || snapshot.version !== 1 || snapshot.circuitId !== this.compiled.id || snapshot.fingerprint !== this.compiled.fingerprint || !Number.isSafeInteger(snapshot.cycle) || snapshot.cycle < 0) {
      throw new RangeError('Snapshot does not match this compiled circuit or has an invalid cycle.');
    }
    const checkWords = (record: Record<string, number>, entries: readonly { id: string; width: number }[], name: string): void => {
      if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== entries.length) throw new RangeError(`Invalid snapshot ${name}.`);
      for (const entry of entries) {
        const value = record[entry.id];
        if (!Object.hasOwn(record, entry.id) || value === undefined || !Number.isInteger(value) || value < 0 || value > maskForWidth(entry.width)) throw new RangeError(`Invalid snapshot ${name}: ${entry.id}.`);
      }
    };
    checkWords(snapshot.inputs, this.compiled.inputs, 'inputs');
    checkWords(snapshot.state, this.compiled.states, 'state');
    checkWords(snapshot.clocks, this.compiled.clocks, 'clocks');
    checkWords(snapshot.clockLevels, [
      ...this.compiled.states.map(state => ({ id: state.id, width: 1 })),
      ...this.compiled.memories.filter(memory => memory.kind === 'RAM').map(memory => ({ id: memory.id, width: 1 })),
    ], 'clock levels');
    if (!snapshot.memories || typeof snapshot.memories !== 'object' || Array.isArray(snapshot.memories) || Object.keys(snapshot.memories).length !== this.compiled.memories.length) throw new RangeError('Invalid snapshot memories.');
    this.compiled.memories.forEach((definition, index) => {
      const contents = snapshot.memories[definition.id];
      if (!Object.hasOwn(snapshot.memories, definition.id) || !Array.isArray(contents) || contents.length !== this.memory[index]!.length || contents.some(value => !Number.isInteger(value) || value < 0 || value > maskForWidth(definition.width))) throw new RangeError(`Invalid snapshot memory: ${definition.id}.`);
    });
    for (const input of this.compiled.inputs) this.signals[input.signal] = snapshot.inputs[input.id]!;
    for (const state of this.compiled.states) this.signals[state.q] = snapshot.state[state.id]!;
    for (const clock of this.compiled.clocks) this.signals[clock.signal] = snapshot.clocks[clock.id]!;
    this.compiled.memories.forEach((memory, index) => this.memory[index]!.set(snapshot.memories[memory.id]!));
    this.currentCycle = snapshot.cycle;
    this.dirty = true;
    this.evaluate();
  }
}
