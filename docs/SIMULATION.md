# Simulation semantics

NandForge uses one deterministic digital simulation engine for the Circuit Lab, reusable chips, Academy verification, and the CPU. The core in `src/core/` has no dependency on React, browser timers, the DOM, or CPU instruction metadata.

## Signals and primitive boundaries

A signal is an unsigned integer on a bus with an explicit width from 1 through 16. The simulator stores words in a `Uint32Array`; the logical mask is `(1 << width) - 1`. Values have two states per bit, zero and one. NandForge does not model unknown, floating, high-impedance, analog, transistor, or physical timing behavior.

Connections must join an output pin to exactly one driver for an input pin of the same width. Fan-out from one output to many inputs is valid. Use SPLIT and JOIN to cross bus boundaries. `b0` is always the least significant bit. Inspect values in binary, unsigned decimal, or hexadecimal; different displays observe the same signal.

The execution boundaries are deliberately small:

| Primitive | Semantics |
| --- | --- |
| NAND | Bitwise inverted conjunction, masked to the declared width |
| INPUT | User-controlled value, held until explicitly changed |
| CONST | Fixed value from the circuit definition |
| CLOCK | Explicit source clock controlled by `step()` or `setClock()` |
| DFF | Idealized positive-edge state element, one word per instance |
| RAM | Idealized asynchronous read and synchronous write memory |
| ROM | Idealized asynchronous read memory with externally loaded contents |
| OUTPUT | An observable input pin; it executes no arithmetic |
| SPLIT / JOIN | Pure bit extraction and bus composition, with no Boolean shortcut |

All other built-in components expand into real subcircuits. AND, OR, NOT, NOR, XOR, XNOR, buffers, multiplexers, arithmetic, comparisons, decoder logic, enabled registers, and counters ultimately execute NAND operations. For example, XOR is four NANDs per bit. A full adder uses nine single-bit NANDs. A register is an enabled NAND multiplexer feeding a DFF; a counter adds a ripple-carry incrementer and reset selection.

Idealized memories are not claimed to be constructed from individual NANDs. A bus-width NAND operation evaluates independent NAND gates together, so an 8-bit NAND counts as eight gates even though the engine can execute it with one JavaScript bitwise expression.

### Arithmetic conventions

- ADDER computes `sum = (a + b + cin) mod 2^width`. `cout` is the unsigned carry-out.
- SUBTRACTOR computes `sum = (a - b - cin) mod 2^width`. Its `cin` is **borrow-in** and `cout` is **borrow-out**. This educational component's flag convention differs intentionally from the CPU ISA's SUB carry flag, which means **no borrow**.
- ADDER and SUBTRACTOR permit an unconnected `cin` with an explicitly specified default of zero. The compiler inserts a real constant source. Every other required input must be wired; an incomplete circuit is diagnosed rather than quietly treated as zero.
- COMPARATOR compares unsigned words and outputs exactly one of `eq`, `lt`, or `gt`.
- `setInput` normalizes safe integer values modulo the source width. NaN, infinity, fractions, and unsafe integers are rejected. Memory images and configured initial values must already fit their declared unsigned widths.

## Compilation and hierarchy

`compileCircuit(circuit, chips)` follows these stages:

1. Validate component identifiers, typed pins, configuration ranges, required connections, driver uniqueness, memory images, and chip interfaces.
2. Walk reachable custom definitions. Detect recursive references, invalid bindings, missing chips, and unbound internal input ports before expansion.
3. Expand built-in and custom chips. Each instance receives a unique slash-separated internal path, such as `registers/accumulator/dff-0`.
4. Unify wire and module-port aliases into compact electrical nets. Module INPUT/OUTPUT boundaries become aliases; they do not create hidden new signal drivers.
5. Build dependencies for combinational operations. DFF outputs are sources; their data and clock inputs terminate at state. Memory read outputs depend on address, while RAM write inputs terminate at state.
6. Apply stable topological sorting. Component IDs determine ordering, so reordering a JSON component or connection array does not change execution. An unresolved dependency cycle produces `COMBINATIONAL_LOOP` instead of iterative guessing.
7. Allocate a compact operation schedule, source descriptors, sequential descriptors, memory descriptors, public pin references, and a circuit fingerprint.

A simulator evaluates each scheduled operation once when sources or state change. Repeated reads of unchanged signals perform no netlist work. This is a compiled full-pass evaluator with dirty-state skipping; it does **not** claim per-net event propagation or worker execution. Compiled built-in blueprints are reused to reduce elaboration cost. Separate simulator instances own separate values and memory.

Reading `simulator.read(nodeId, pin)` works for top-level pins and expanded internal paths. Both the input and output side of a module boundary resolve to the same underlying live nets. This lets the CPU inspector observe the circuit actually executing.

## Clocks and atomic state updates

NandForge uses a synchronous, explicit-source-clock model. Changing a data input while paused reevaluates combinational logic and does not clock registers. Call `step()` for one complete low → high → low pulse across all CLOCK components, or `setClock(nodeId, 0 | 1)` to inspect an individual half-clock transition.

For each explicit source-clock transition:

1. Settle the current combinational network.
2. Capture every DFF's data and current clock, and each RAM's write enable, address, data, and clock from this same **pre-edge** state.
3. Change the source clock levels and settle the combinational network to detect clock-pin edges.
4. Identify every DFF/RAM whose own clock input changed from zero to one.
5. Apply all selected updates simultaneously using the captured data.
6. Reevaluate combinational outputs and expose one stable observable result.

The ordering means two DFFs exchanging their stored words swap correctly. A RAM write and a register reading that RAM on the same edge both use the old read value/address until the entire state batch commits. A DFF whose data is connected to the source clock itself captures the pre-edge low value, not the post-edge high value.

A clock passed through NAND-derived gating or inversion is resolved from its actual signal values. An inverted clock's positive edge occurs during the source's falling phase and is handled as a separate explicit transition. This synchronous model does not propagate asynchronous clock cascades caused solely by state-output changes or treat ordinary INPUT changes as new clock events. Use CLOCK components as the clock sources; combinational feedback must cross a DFF data boundary, not be used to build an asynchronous oscillator. No physical hazard, metastability, or gate-delay behavior is claimed.

`step(observer?)` increments `cycle` once and optionally calls an observer after the stable rising and falling phases. The observer reads real values with `read`; waveform traces are recorded from these observations. At normal step completion, source CLOCK outputs are low. A debugger can show both phases without fabricating a display-only clock.

The CPU connects all architectural state to the same source clock and uses register enables for control. It therefore performs exactly one atomic architectural transition per instruction. Its adapter stops issuing clock steps after HALT or FAULT; control logic also inhibits architectural writes.

## Memory

RAM and ROM have independent data width (`width`) and address width (`addressWidth`, default 8). Both widths support 1 through 16. Capacity is `2^addressWidth` words, and configured images shorter than capacity are zero-filled explicitly.

- Reading either memory is combinational: changing `addr` immediately changes `out` when the circuit settles.
- RAM writes only if `we = 1` at a positive clock edge. Address, data, and write enable come from the same pre-edge state as every DFF.
- The stable post-edge output reflects the updated memory and whichever address the newly updated circuit produces.
- `setMemory(nodeId, contents)` replaces an image transactionally, zero-fills unused words, validates the complete range first, and updates combinational reads. It is an external image load, not a simulated CPU instruction.
- `getMemory(nodeId)` returns a copy, so inspecting a memory cannot mutate it accidentally.

## Reset, snapshots, and replay

`reset()` restores the compiled definition's initial INPUT values, DFF words, RAM/ROM images, low clocks, and cycle zero. The CPU wrapper additionally reloads the currently assembled program and its original RAM image; resetting CPU execution preserves the loaded program.

`snapshot()` returns plain JSON-serializable data:

```ts
interface SimulatorSnapshot {
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
```

Internal state keys contain full instance paths, so separate instances of a custom sequential chip never alias. A topology/configuration fingerprint prevents applying a snapshot to a changed circuit that happens to have the same circuit ID. Position and display labels do not change circuit behavior.

`restore(snapshot)` checks version, identity, cycle, record keys, word ranges, and every memory image before mutation, then recomputes derived combinational signals. Snapshots therefore preserve loaded memory, external input, state, clocks, and execution position. Stepping backward in the debugger restores saved state; it does not try to invert arithmetic instructions.

## Diagnostics and bounded work

Validation errors use stable machine-readable codes, including `MISSING_INPUT`, `WIDTH_MISMATCH`, `MULTIPLE_DRIVERS`, `INVALID_PIN`, `MISSING_NODE`, `MISSING_CHIP`, `RECURSIVE_CHIP`, `COMBINATIONAL_LOOP`, `INVALID_WIDTH`, `INVALID_CONFIG`, `INVALID_PORT`, `UNBOUND_PORT`, and `LIMIT_EXCEEDED`. Messages include the affected component, pin, or connection where available. `CircuitError.diagnostics` carries errors; a successfully compiled circuit exposes its diagnostics array.

The core caps individual definitions at 25,000 components and 150,000 connections; custom hierarchy validation at 48 levels; expanded primitive nodes at 100,000; and aggregate memory capacity at 1,048,576 words, requiring 4 MiB of typed storage. These checks occur before simulator memory allocation. The project import boundary applies its own, tighter document and hierarchy limits as well. No circuit input is executed as JavaScript, and there is no `eval` path.

Truth tables enumerate real simulator outputs for combinational circuits. The default cap is eight total input bits (256 rows), with a maximum explicit cap of 16 bits and an additional 50-million-operation work limit. Stateful circuits, missing output probes, and oversized enumerations produce explicit diagnostics. The Academy's behavioral validation uses the same simulation semantics.

## Statistics and verification

`compiled.stats.components` and `wires` describe the authored top-level graph. `gates` sums the bit width of expanded NAND operations. `sequential` counts idealized DFF word instances and RAM primitives. `depth` counts NAND and memory-read dependency stages, while SPLIT/JOIN contribute no stage. This is idealized logical depth, not a propagation delay in seconds or a transistor count. `expandedComponents`, `expandedWires`, and the operation schedule are also inspectable.

Run `npm test -- tests/core` for primitive truth tables, exhaustive arithmetic, buses, validation failures, memory ordering, explicit clock phases, nested chips, instance isolation, snapshots, and deterministic replay. CPU tests independently compare the gate circuit against a test-only reference interpreter. `npm run bench` measures small, medium, large, CPU, and waveform/history workloads; see [BENCHMARKS.md](BENCHMARKS.md) for the actual recorded measurements and their limits.
