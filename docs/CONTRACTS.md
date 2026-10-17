# NandForge implementation contracts

Repository: `Berkopan/NandForge`. Static URL base: `/NandForge/` (case matches the actual repository; never silently assume the original lowercase placeholder). Hash navigation. MIT. English default, Turkish toggle. No backend.

## Ownership

- Engine engineer: `src/core/**`, `tests/core/**`, `docs/SIMULATION.md`.
- CPU engineer: `src/cpu/**`, `src/assembler/**`, `tests/cpu/**`, `docs/CPU.md`, `docs/ISA.md`.
- Editor engineer: `src/editor/**`, `tests/editor/**`; engine integration and its own CSS.
- Lead: app shell, shared UI, Academy, persistence, localization, debugger UI, platform, CI, docs, integration.
- Lead alone manages Git commits and remote state. Do not commit or edit another owner's files without coordination.

## Shared data model

`src/core/types.ts` is the canonical schema. A Circuit has components and pin-to-pin connections. Both editor and CPU use this exact representation. Built-in combinational component types expand to NAND netlists; only INPUT, OUTPUT, CONST, CLOCK, NAND, DFF, RAM, ROM, SPLIT and JOIN may be primitive execution operations. No opcode dispatch in runtime.

Pin conventions: INPUT/CONST/CLOCK output `out`; OUTPUT input `in`; NAND/basic binary gates `a,b -> out`; NOT `in -> out`; DFF `d,clk -> q`; REGISTER `d,clk,en -> q`; RAM `addr,d,we,clk -> out`; ROM `addr -> out`; MUX `a,b,sel -> out`; ADDER/SUBTRACTOR `a,b,cin -> sum,cout`; comparator `a,b -> eq,lt,gt`; SPLIT `in -> b0,b1,...`; JOIN `b0,b1,... -> out`. Single-bit join/split. Half adder `a,b -> sum,carry`; full adder `a,b,cin -> sum,cout`. For other components, `getComponentSpec` is the source of truth.

`Component.config.width` defaults to 1; memory addressWidth defaults to 8. Memory contents and initial values are data. CHIP config.chipId names an explicit ChipDefinition. Module ports bind to internal INPUT/OUTPUT node IDs, retaining typed boundaries.

## Core public API (engine engineer implements)

- `getComponentSpec(component, chips?) -> ComponentSpec` with typed input/output pins, category, description.
- `COMPONENT_CATALOG` and `createComponent(type, id, position?, config?)`.
- `validateCircuit(circuit, chips?) -> Diagnostic[]`.
- `compileCircuit(circuit, chips?) -> CompiledCircuit`, throws `CircuitError` containing diagnostics.
- `new Simulator(compiled)`: `evaluate()`, `setInput(nodeId,value)`, `step()`, `read(nodeId,pin)`, `snapshot()`, `restore(snapshot)`, `reset()`, `setMemory(nodeId, contents)`, `cycle`.
- `step()` executes one complete atomic rising-clock transition across CLOCK components. All sequential elements sample the same pre-edge stable state. Input changes while paused update combinational signals; do not clock ordinary registers.
- `CompiledCircuit.stats`: components, wires, gates, sequential, depth.
- `Simulator.snapshot()` is plain serializable data including all sequential state, input state, memory, clocks and cycle; restore is deterministic.
- `getChipForComponent(component,chips?) -> ChipDefinition | undefined` for inspecting real expanded implementations.
- `TEMPLATES: {id,name,description}[]`, `createTemplate(id) -> Circuit`.
- `truthTable(circuit,chips?,maxInputBits=8)` evaluates the real simulator; structured results include named inputs and outputs and diagnostics.

If a contract needs an adjustment, message the relevant owners and lead before proceeding. Re-export stable API from `src/core/index.ts`.

## CPU public API (CPU engineer implements)

- `buildCpuCircuit() -> { circuit: Circuit, chips: ChipDefinition[] }` exposes real hierarchical subsystems and named top-level register/control outputs.
- `CpuMachine`: runtime wraps ONLY Simulator; no opcode interpreter. `load(rom,ram?)`, `step()`, `reset()`, `setInput(value)`, `state` getter, `snapshot()`, `restore(snapshot)`, `simulator`, `circuit`, `chips`. `state` includes a,pc,z,c,output,input,halted,fault,cycles,ram,opcode,operand and control signal values.
- `assemble(source) -> {ok,rom,listing,diagnostics,symbols}`. Listing entries include address, word, line, source, mnemonic. Diagnostics include line,column,message.
- `EXAMPLE_PROGRAMS` with id,name,description,source,expectedOutput where deterministic final output is defined.
- Independent reference CPU must be in test-only files, never imported into browser runtime.
- CPU snapshots include the core snapshot; debugger history operates by restore, not by reversing instructions.

## Editor component API (editor engineer implements)

`CircuitEditor` props: `circuit: Circuit`, `chips: ChipDefinition[]`, `onChange(circuit)`, `onChipsChange(chips)`, `language: 'en'|'tr'`, optional `readOnly`, optional `onNotify(message)`.

The editor owns transient simulation, selection and editor undo/redo; parent owns the serializable project. On external project/circuit ID change, reset transient history. Engine diagnostics must be visible. Probe/waveform UI may be in editor, or export observation hooks to coordinate with lead. Translate editor strings internally through a small typed EN/TR dictionary to avoid dependency on root i18n implementation.

## Integration expectations

Tests must exercise behavior, not mirror implementation. Comprehensive deterministic exhaustive and differential tests are required. Avoid massive single-file modules. Preserve bounded waveform/history memory. Every shipped control must work. Use real core output for both rendering and challenge verification.
