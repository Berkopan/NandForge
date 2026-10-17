# Contributing to NandForge

NandForge connects visual circuit construction to an actual circuit-based CPU. A useful contribution preserves that connection: the values shown in the interface must come from the implementation users can inspect.

## Set up a development checkout

Use Node.js 24 and the checked-in npm lockfile:

```sh
git clone https://github.com/Berkopan/NandForge.git
cd NandForge
npm ci
npm run dev
```

The development URL is `http://localhost:4173/NandForge/`. Read [Architecture](ARCHITECTURE.md), [Simulation semantics](SIMULATION.md), and [Shared contracts](CONTRACTS.md) before changing a module boundary. The [CPU](CPU.md) and [ISA](ISA.md) documents define the processor's architectural behavior.

## Module responsibilities

| Area | Responsibility | Important dependencies |
| --- | --- | --- |
| `src/core/` | Typed graph, built-in circuits, validation, hierarchy compilation, deterministic runtime. | Must remain independent of React, DOM, and CPU opcodes. |
| `src/cpu/` | Circuit authoring for the processor and a thin observation/load adapter. | Uses the shared graph and simulator. |
| `src/assembler/` | Source parsing, safe expressions, symbols, instruction encoding, diagnostics. | Instruction metadata; no circuit execution. |
| `src/editor/` | React Flow interaction, graph operations, inspector, chip extraction, waveforms. | Reads real core values; parent owns serialized projects. |
| `src/debugger/` | CPU UI, stepping, stops, history, sampling. | Restores actual simulator snapshots. |
| `src/academy/` | Explanations, starters, expected behavior, circuit verification. | Verifies functions through the core, not visual patterns. |
| `src/persistence/` | Schema, validation, local persistence, compressed sharing. | Treats all incoming content as data. |
| `src/i18n/`, `src/views/` | Shared localization and product navigation. | Keep English and Turkish aligned. |

Keep implementation files focused. Prefer extending the existing schema and contracts over inventing a second representation for a particular screen. Do not add a backend, account requirement, telemetry, or external API dependency to solve a browser-local requirement.

## Change and review workflow

Create a branch with a descriptive name. Keep commits scoped to coherent changes, such as a simulation fix and its regression or one complete user interaction. Explain the concrete problem, the resulting behavior, and the evidence in the pull request.

For visual changes, include an actual screenshot from the running application and describe the tested viewport. For behavioral fixes, include a regression that fails under the previous behavior. Screenshots, benchmark figures, and test claims should reflect work actually performed.

Run the checks relevant to the change while iterating. Before requesting review, run the complete validation path:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

CI additionally runs Firefox and WebKit. Run those locally when changing browser interaction, downloads, persistence, compression, or responsive behavior:

```sh
npx playwright install --with-deps chromium firefox webkit
PLAYWRIGHT_ALL_BROWSERS=1 npm run test:e2e
```

Playwright serves `dist/` on port 4174 under `/NandForge/`. This intentionally verifies the production base path and keeps the test server separate from development on port 4173. Tests use isolated browser contexts. See [Deployment](DEPLOYMENT.md) for existing-server configuration and GitHub Pages behavior.

## Add or change a circuit component

1. Define its configuration and pin contract in `src/core/types.ts` and `src/core/catalog.ts`. Each pin has an explicit width; optional inputs need documented defaults.
2. For a combinational component, build its real implementation in `src/core/chips.ts` using existing gates and NAND primitives. Make `getChipForComponent` expose the implementation for inspection.
3. If a new idealized primitive is truly needed, specify its evaluation and clock semantics before adding it. Update validation, compilation, snapshots, and both reset/restore paths together.
4. Add palette metadata, useful descriptions, configuration controls, and English/Turkish text. An inspector field should change actual circuit data; a displayed output must come from the simulator.
5. Add meaningful tests for the pin contract, valid behavior, relevant invalid wiring, bus boundaries, and hierarchy. Use exhaustive truth tables for small functions and deterministic edge cases for larger spaces.
6. Document the behavior and add a working template where it helps users discover the feature.

A bus-width change can invalidate existing wiring. Keep the resulting diagnostics actionable. Do not quietly treat a missing required input as a legitimate zero. Signal `0` and an unavailable/unconnected value have different meanings.

Selection-based custom chips introduce explicit port components at incoming and outgoing graph boundaries. Deduplicate boundaries with unambiguous endpoint keys, preserve widths and fan-out, and retain every output pin distinctly. Saved definitions must remain self-contained with their project's nested chip definitions.

### Clock and state changes

All affected state elements sample a common stable pre-edge state. Register updates must not depend on JavaScript iteration order. Data changes while paused must not create clock edges. Add tests that swap state between registers, exercise enables, test feedback, and compare restored/replayed snapshots.

Internal inspection reads the selected instance through the existing simulator's hierarchy path. Opening a register must not replace its live value with a new simulator's reset state. Test more than one instance so accidentally reading the wrong scope is detectable.

## Change the CPU or instruction set

The production processor is a circuit. Express instruction decoding, ALU selection, writes, and branches through component networks. An opcode execution interpreter belongs only in tests.

For an ISA change, update the metadata, assembler encoding, circuit decoding/control, independent reference model, example programs if affected, and the ISA document. State exactly which flags change, how PC advances, and what happens at byte boundaries.

Compare actual processor state with the reference after each instruction, including all RAM cells, PC, A, flags, input/output, halt/fault, and cycle count. Broad deterministic programs supplement explicit boundary tests; they do not replace them. Keep the reference implementation independent of the runtime's control equations so the two are less likely to share a mistake.

Use the debugger's snapshot restoration for time travel. If execution resumes after rewinding, discard the old future before appending new history. Breakpoints stop before an instruction; memory watchpoints stop after the instruction that changes the location. Preserve those boundaries in tests.

## Add an Academy challenge

Add the lesson's bilingual title, objective, explanation, instructions, expected result, and hint in `src/academy/lessons.ts`. Define its public port names and widths, construct an editable starter, and implement behavioral verification in `src/academy/verify.ts` as needed.

A correct circuit may have a topology you did not anticipate. Check observable behavior across the relevant inputs, and use structural restrictions only when the lesson explicitly requires them, such as building from NAND. Failure feedback should identify a useful input/state sequence and show expected and actual outputs.

Ensure reset restores the starter, the lesson can continue as a sandbox project, and progress persistence works without an account. Exercise the new challenge through the interface as well as its pure verification function.

## UI and localization

Every visible control needs an implemented action, a meaningful disabled state, or an explanatory empty state. Preserve keyboard access, labels, visible focus, and a practical narrow-screen view. Do not encode important information with color alone.

The main dictionary is `src/i18n/index.ts`; template metadata is in `src/i18n/templates.ts`. Editor text is intentionally kept in its typed `src/editor/i18n.ts` dictionary to preserve the editor module boundary. Add both English and Turkish entries for principal controls and explanations. Keep public pin names, opcodes, and machine-code values stable across languages.

Browser tests that inspect chip internals should target the visible `.nf-editor-layer`. Parent layers remain mounted but hidden to preserve sequential state and editor history; their node IDs may also exist in the document.

## Persistence and imported data

The versioned project schema contains the circuit, embedded chip definitions, source code, and metadata. New fields need explicit defaults or migration handling. Export/import should preserve a valid project's behavior and topology, while import rejects invalid structure, recursive modules, dangerous property names, excessive sizes, and invalid pin boundaries.

Do not use `eval`, dynamic function construction, or HTML injection for imported source or project data. Assembly expressions use a restricted parser. Compressed URL shares need bounds on both encoded data and decompressed output. Storage failure must leave the user's current work available for export.

Remember that an unfinished editor document may have useful diagnostics. Autosave and reopening must not lose the whole workspace because one draft cannot currently simulate. Keep strict external-import checks and internal draft recovery behavior deliberate and tested.

## Performance work

Use `npm run bench` before and after changes to compilation, runtime evaluation, snapshots, or waveform storage. Record the environment, workload, iteration count, and measurement method. Compare equivalent work and check outputs; repeatedly reading an unchanged value is not a useful substitute for a changing-signal workload.

The existing script covers a small XOR, hundreds and thousands of NAND gates, real CPU execution, and sustained debugger history/sampling. Preserve bounded capture and history. Node timings do not measure browser layout, React rendering, or physical circuit propagation. For UI performance changes, measure the corresponding browser workflow separately.

See [Benchmarks](BENCHMARKS.md) for the current measured scenarios and limitations. Avoid adding optimization layers until they resolve a demonstrated cost without weakening simulation semantics.

## Licensing

NandForge is MIT licensed. Contributions should be compatible with the [MIT License](../LICENSE). Use original assets or assets with a suitable license and clear provenance. Changes to dependencies should include the lockfile and pass the normal validation gates.
