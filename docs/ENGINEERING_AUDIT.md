# Engineering audit and execution evidence

This document records implementation review, executed behavioral checks, and defects found during the NandForge build. It distinguishes source review, local test execution, browser execution, and deployment evidence. A test file's presence is not treated as a passing run, and a Pages workflow's presence is not treated as a live deployment.

The detailed acceptance ledger is [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), with structured records in [implementation-status.json](implementation-status.json). This audit checkpoint is dated **2026-10-17**. The integration owner updates final whole-tree gates, remote CI, and public deployment results as they become available.

## Requirement provenance and review scope

The implementation was checked against the user-provided engineering brief named `Yapıştırılan metin(20261017-184928).txt`, including its original A–N acceptance scenarios, explicit primitive boundaries, CPU instruction set, arithmetic flags, and testing requirements. The user corrected the target repository to `Berkopan/NandForge`; the application and deployment base consequently use `/NandForge/`. The private brief itself is not reproduced or committed here.

Work was split across engine, CPU, editor, and integration responsibilities. Independent review crossed those boundaries: the engine implementer inspected the CPU netlist and editor state observation, the CPU implementer exercised persistence/debugger/Academy and browser workflows, and the editor implementer identified a persistence failure caused by an ordinary inspector edit. This is an engineering review with reproducible tests, not a claim of formal verification or an external security certification.

## Direct proof that the CPU executes its circuit

Two tests in [tests/core/cpu-integrity.test.ts](../tests/core/cpu-integrity.test.ts) establish a concrete execution path independently of the CPU adapter.

The first constructs `buildCpuCircuit()`, passes that ordinary graph and its chips to `compileCircuit()`, creates a generic `Simulator`, loads these six ROM words, and issues six complete clock steps:

```text
0103 03F0 0104 04F0 1000 FF00
```

They encode `LDI 3; STA 240; LDI 4; ADD 240; OUT; HLT`. The observed assertions are:

| Pin or memory | Observed result |
| --- | ---: |
| Register bank A | 7 |
| I/O OUT register | 7 |
| Program counter | 5 |
| HALTED | 1 |
| RAM[240] | 3 |

The compiled combinational schedule contains only NAND, SPLIT, JOIN, RAM and ROM operations. No `CpuMachine` instance or instruction interpreter executes this test.

The second changes the actual ALU connection feeding the ripple adder's B input to a new eight-bit zero constant. It runs the same six ROM words on the modified graph. RAM[240] remains 3, the processor does not fault, and OUT becomes **4**. Thus the visible graph's wiring determines the CPU's result; the graph is not an animation driven by a separate opcode evaluator.

The independent software reference model is confined to [tests/cpu/reference.ts](../tests/cpu/reference.ts). Production execution is in [src/core/simulator.ts](../src/core/simulator.ts), while [src/cpu/machine.ts](../src/cpu/machine.ts) only adapts loading, stepping, observation, reset and snapshot operations.

## Behavioral verification performed

### Core and arithmetic

Core assertions cover primitive truth tables, all supported signal widths, NAND composition, compilation failures, hierarchy, atomic state, memory, reset, snapshots, and the direct CPU integrity checks. Concrete suites are [combinational](../tests/core/combinational.test.ts), [arithmetic](../tests/core/arithmetic.test.ts), [sequential](../tests/core/sequential.test.ts), [validation](../tests/core/validation.test.ts), [hierarchy](../tests/core/hierarchy.test.ts), [templates](../tests/core/templates.test.ts), and [CPU integrity](../tests/core/cpu-integrity.test.ts).

Arithmetic coverage includes every eight-bit A/B pair with both carry-in values for ADDER and both borrow-in values for SUBTRACTOR: **131,072 vectors for each component**. The unsigned eight-bit comparator covers all **65,536 input pairs**. Separate boundary and deterministic wider vectors exercise sixteen-bit behavior. These are assertions on real simulated outputs, including wraparound and carry/borrow pins.

Sequential cases test changes while paused, enabled/disabled register updates, two state elements exchanging old values, memory address/write ordering, multiple clocks, actual inverted/gated clock phases, reset and JSON snapshot replay. Invalid snapshots and memory images are rejected before mutation. Hierarchy tests cover independent sequential instances and changed-topology snapshot rejection.

The clock model remains explicitly synchronous. The audit did not broaden ordinary INPUT changes into asynchronous clock events, and it does not claim physical timing behavior. That model boundary is tested and explained in [SIMULATION.md](SIMULATION.md).

### CPU and assembler

Every one of the 256 possible opcode bytes is compared with an independent reference, including reserved opcode faults. ADD and SUB each cover all 65,536 byte pairs; shifts and NOT cover all 256 accumulator values. Ninety-six deterministic programs provide **12,288 complete architectural transitions** checked against the independent reference.

Comparisons include A, PC, Z/C, input, output, halted/fault state, cycle count, and all 256 RAM bytes after every instruction. The suite also assembles and executes every shipped example, checking its complete output sequence. Boundary cases cover RAM addresses, PC wraparound, old-flag branches, carry preservation, IN sampling, latched OUT, halt behavior, load atomicity, reset, snapshots, and actual clock-phase callbacks. [CPU tests](../tests/cpu/cpu.test.ts), [ALU tests](../tests/cpu/alu.test.ts), [assembler tests](../tests/cpu/assembler.test.ts).

Independent code review compared the exact nineteen opcodes and flag rules against the brief. No CPU arithmetic or control defect was identified. The educational SUBTRACTOR component exposes borrow-out, while CPU SUB intentionally uses two's-complement addition and exposes **no-borrow** as C. This distinction is documented in both [SIMULATION.md](SIMULATION.md) and [ISA.md](ISA.md).

### Editor, Academy, debugger and persistence

Editor model checks cover real chip extraction, saved NAND-XOR reuse, typed multi-output boundaries, copy/paste rewiring, deletion, deterministic layout and live nested register inspection. They compile and execute the resulting circuits. [Editor model tests](../tests/editor/model.test.ts).

Academy tests run candidate circuits against actual outputs, reject an unclocked register passthrough, catch a disabled-enable failure, enforce the NAND-only challenge constraint before behavioral verification, and check localized feedback. The small combinational tasks use complete input enumeration; larger arithmetic tasks use boundary and deterministic sample vectors. The CPU programming challenge reads the real loaded machine's halted state and OUT value. [Academy verifier](../src/academy/verify.ts), [Academy tests](../tests/academy/verify.test.ts).

Debugger checks cover stops before breakpoints, one-time resume bypass, looping breakpoints, RAM-change watchpoints, halted/fault behavior, backward/forward restoration of full machine state, discarded future histories, rejected input edits preserving history, reset clearing a pending breakpoint bypass, bounded storage, recording controls and real phase exports. [Debugger tests](../tests/debugger/session.test.ts), [waveform tests](../tests/editor/waveforms.test.ts).

Persistence checks cover document parsing, sharing, local storage and draft recovery. They exercise unsafe keys, schema/version/range failures, recursion and expansion limits, custom chip interface validation, failed writes, malformed records, and preservation of healthy projects beside invalid drafts. [Project tests](../tests/persistence/projects.test.ts), [storage tests](../tests/persistence/storage.test.ts), [draft recovery tests](../tests/persistence/draft-storage.test.ts).

The final integrated unit run passed **218 tests in 17 files**, with a reported duration of **1.72 seconds**. Global TypeScript and ESLint checks also passed. The count is the final whole-tree result; arithmetic vectors are assertions within those tests.

## Browser execution evidence

The final production suite under `/NandForge/` passed **60 browser executions in 73.60569 seconds**: **20 scenarios each in Chromium 156, Firefox 157 and WebKit 27.2**, with **0 unexpected, flaky or skipped tests**. The tested production asset was `index-B85FVxlb.js`. This is one complete final run; earlier runs are not added to its count. Its duration describes test execution, not product performance.

The workflows exercise palette creation and wiring, all four AND combinations, XOR's complete 0/1/1/0 truth table, inspection of exactly four NANDs with no hidden XOR component, deletion/undo/redo, saving and inspecting a custom chip, source and topology export/import, IndexedDB reload, project rename/duplicate/delete, unsafe import rejection, recoverable width-error drafts, register clock/enable behavior, a real Academy wire challenge, Turkish language persistence, CPU arithmetic and looping examples, breakpoint/resume/rewind, RAM watchpoints, real waveform export, invalid assembly recovery, live CPU circuitry inspection, and a narrow mobile viewport. Every scenario collects uncaught page errors and requires an empty error list. [CPU browser scenarios](../tests/e2e/cpu.spec.ts), [workspace browser scenarios](../tests/e2e/workflows.spec.ts), [Playwright configuration](../playwright.config.ts).

The strengthened localization path observes Turkish CPU source/load/run controls, memory labels and ALU explanation, runs the actual addition program to OUT=7, opens a Turkish Academy lesson, reads its foundation and hint, wires its pins and receives localized successful behavioral verification. The same workflow explicitly switches back to English and checks the restored interface. The Academy reset path also verifies that restoring the starter removes the previous success banner while keeping earned progress after reload.

The test runner serves built assets on a separate preview port, so a development server cannot accidentally substitute for the production build. Browser contexts isolate local storage between scenarios. Screenshots, traces and reports are generated by Playwright; the CI workflow retains its browser report artifact.

The final suite verifies Copy link reports success or actionable manual-copy guidance while the share dialog retains its readable URL, then opens that compressed URL in a fresh browser context and checks the restored working project. The test accepts the platform-dependent copy result; it does not force clipboard denial. A real 100 Hz CPU loop exercises manual pause, snapshot restoration, reset, source editing and reassembly; these operations synchronously cancel scheduled ticks. Watchpoint stopping remains exact in all three engines. These checks verify the corrections exposed by the browser runs.

Five final PNGs were regenerated from that production build and individually visually checked. The half-adder capture shows a=1,b=1, sum=0, carry=1 and all four truth-table rows; desktop CPU shows OUT=7, cycle=6 and PC HOLD; mobile CPU shows OUT=42, cycle=3. Desktop captures use a 1440×1000 viewport and mobile uses 390×844, with full-page output at scale 1. The editor viewport is bounded after internal inspection, and a separate mobile Circuit Lab check confirmed the visible switch changes its real output. The English and Turkish README galleries embed the final assets. [Screenshots](screenshots/), [English gallery](../README.md#screenshots), [Turkish gallery](../README.tr.md).

Manual cloud-preview inspection also loaded the home screen and ran the 3 + 4 program through the actual CPU controls on an ordinary HTTP origin. The observed machine halted with OUT=7 after six cycles. This exposed and then confirmed the correction of a startup failure caused by assuming `crypto.randomUUID` was always present. It is local preview evidence, not evidence that GitHub Pages has deployed.

## Findings and resolutions

| Finding | Practical effect | Resolution and evidence |
| --- | --- | --- |
| Internal inspection created a new simulator | A displayed nested register could show reset state instead of the value in the running parent chip | Inspection now forwards the same simulator with an accumulated instance path. A regression constructs two register instances holding 42 and 19, changes D while paused, then clocks one new value and checks the correct nested state. `src/editor/useCircuitRuntime.ts`, `src/editor/CircuitEditor.tsx`, `tests/editor/model.test.ts` |
| Strict decoding rejected ordinary saved drafts as a group | Changing an input from one bit to eight bits could save a width-invalid draft; reopening the project list then appeared to lose all projects | Internal `parseProject(..., { allowDraft: true })` preserves typed semantic-error drafts, while external import remains strict. Listing isolates malformed records and reports their count. Raw records survive fallback saves/deletes. `src/persistence/projects.ts`, `storage.ts`, `tests/persistence/draft-storage.test.ts`; real IndexedDB regression also passed in all three browsers |
| Endpoint deduplication concatenated node/pin names | Punctuation in identifiers could make distinct endpoints share the same textual key | Chip-boundary deduplication and persistence driver checks use JSON tuples. Source review confirms distinct node/pin pairs remain distinct. `src/editor/model.ts`, `src/persistence/projects.ts` |
| Undo history captured a changing closure | An asynchronous history update could capture the wrong prior graph | The editor captures the previous circuit before invoking the history updater. The browser deletion/undo/redo scenario restores actual wiring and simulated output. `src/editor/CircuitEditor.tsx`, `tests/e2e/workflows.spec.ts` |
| Invalid debugger input edits truncated history too early | A rejected value could destroy a rewound session's valid future states | Input validation now succeeds before future-history truncation. A regression checks both full history and snapshot are unchanged on rejection. `src/debugger/session.ts`, `tests/debugger/session.test.ts` |
| Reset retained an unused breakpoint bypass | Reset between Resume and the next timer tick could skip the next breakpoint | Reset clears the bypass flag; a specific regression checks the breakpoint is hit after reset. `src/debugger/session.ts`, `tests/debugger/session.test.ts` |
| Queued browser timers advanced after a stop | Firefox exposed another execution slice before effect cleanup; a pending effect could also restart execution after a manual control action | Synchronous cancellation, run-request and generation guards now protect watchpoint stops, pause, restore, reset, source edits and reassembly. The final 60-browser run passes the watchpoint and 100 Hz lifecycle regressions. `src/debugger/CpuLab.tsx`, `src/editor/useCircuitRuntime.ts`, `tests/e2e/cpu.spec.ts` |
| Duplicate used the last saved project object | Changes within the autosave debounce window could be absent from a duplicate | The current project's latest App reference supplies duplication. Independent source review confirmed the correction, and the strengthened three-engine project workflows pass. `src/App.tsx`, `tests/e2e/workflows.spec.ts` |
| Delete failures were uncaught in the project dialog | A blocked local storage operation could reject without actionable feedback | The handler now catches the failure and shows the storage notice while retaining the dialog/project. Independent source review confirmed the correction. `src/App.tsx` |
| Startup assumed `crypto.randomUUID` existed on every origin | An ordinary HTTP preview could fail before opening a project | Identifier creation uses `crypto.getRandomValues` when `randomUUID` is unavailable. A regression removes `randomUUID`, creates distinct projects, and round-trips their JSON. The 218-test total includes this regression; manual HTTP preview then loaded Home and executed CPU OUT=7. `src/persistence/projects.ts`, `tests/persistence/projects.test.ts` |
| CPU diagram presentation obscured actionable or held state | An SVG image role hid interactive child controls from the accessibility tree, and a halted PC could still display a next-address arrow | The SVG now has a group role containing labelled buttons, and a disabled PC write displays HOLD/TUT. Browser accessibility assertions and final desktop/mobile screenshot review confirm the corrected controls and held state. `src/debugger/CpuDiagram.tsx` |
| Sharing depended entirely on clipboard availability | On the ordinary HTTP preview, the clipboard operation could fail without leaving a usable share URL | The share action now opens a read-only URL dialog, with Copy link, inline manual-copy fallback and JSON export. The final three-engine suite verifies Copy link leaves the URL intact with success or manual-copy feedback, and a fresh browser context imports the shared working project. `src/App.tsx`, `tests/e2e/workflows.spec.ts` |

Review also checked imported hierarchy expansion and memory allocation bounds. Limits are enforced before simulator allocation; unused saved chip definitions receive interface/reference validation. Local draft mode does not bypass prototype-key, schema, reference, hierarchy or resource protections. This is targeted input-hardening evidence, not a claim that every possible hostile browser environment has been tested.

## Session lifecycle review

The App owns project source text. CpuLab assembles that source on entry and never replaces it with a default example during mounting. Leaving CPU Lab ends its transient session; returning restarts execution from the project's current source. Breakpoints, probes, register state and time-travel snapshots do not survive route unmount or browser reload. The browser round-trip test verifies the assembly text itself survives export/import and navigation.

History controls synchronously cancel scheduled clock ticks before selecting an earlier or later snapshot. Run-request and generation guards prevent queued callbacks or effects from restarting a stopped run. Source edits also pause the timer and make Run/Step unavailable until a successful load. Failed assembly preserves the old machine. Entering the live circuitry inspector retains the same CPU session and simulator; returning preserves observed OUT and cycle count, as exercised in all three browsers.

Autosave records a captured immutable project object. It clears the dirty flag only when that exact object is still the current project, so completion of an older save cannot mark a newer edit as saved. Switching projects awaits the dirty current project's save. Storage errors propagate to notices, and malformed local records are not silently rewritten out of storage. No additional autosave race was asserted without a concrete reproducer.

The Academy result lifecycle was also corrected. Each result now retains the exact circuit, chip definitions and source that were verified. A reset or solution edit hides an obsolete result, and a delayed verification callback cannot display a result for an older solution. Earned progress remains independent. Scoped lint and the final integrated typecheck/lint/unit gates passed after the change. The strengthened browser scenario confirms the old success disappears after restoring the starter, while earned completion survives navigation and reload. [Lesson workspace](../src/views/Academy.tsx), [browser regression](../tests/e2e/workflows.spec.ts).

## Performance evidence and limits

The measured benchmark runs the real shared compiler, simulator and debugger. It covers four-NAND XOR, 512-NAND and 8,192-NAND circuits, 12,003 actual CPU instructions, and 5,000 instructions with probes, logs and snapshots. Deterministic output and history restoration are assertions, so invalid execution fails the benchmark instead of producing a throughput claim. [Benchmark script](../scripts/benchmark.ts).

The recorded median CPU adapter throughput was approximately 45,714 instructions/s, and the debugger workload approximately 17,159 instructions/s on the documented local Node runtime. The sustained debugger retained 1,024 samples, 256 snapshots and 256 log entries. Exact environment, sample timings, compilation costs and the 1,144,239-byte retained JSON size are in [BENCHMARKS.md](BENCHMARKS.md).

These measurements exclude DOM layout, paint and canvas interaction. Serialized JSON size is not heap allocation size. Logical gate depth is not physical propagation delay, and a Node instruction rate is not a promised browser clock frequency.

## Final verification boundary

The integrated unit run passed 218 tests, global typecheck and lint are clean, the production build passed, all 60 final browser executions passed in three engines, and five final screenshots passed visual review. All acceptance scenarios A–N are verified. The [remote workflow](https://github.com/Berkopan/NandForge/actions/runs/39064679103), for final code `fcb591e061d429e183aa68011d356b795eea5e07`, completed successfully: the [validation job](https://github.com/Berkopan/NandForge/actions/runs/39064679103/job/117489719266) passed all 14 steps and the [Pages publication job](https://github.com/Berkopan/NandForge/actions/runs/39064679103/job/117490439008) passed all 4. Remote execution separately passed 218 unit tests in 2.82 s and 60 browser executions in 2.1 min. The exact public URL and deployed-site browser smoke check also passed as recorded below. Pages settings already use GitHub Actions, so no owner configuration change is required. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

The deployed **[https://berkopan.github.io/NandForge/](https://berkopan.github.io/NandForge/)** was opened directly. Home started at A=0,B=1 with OUT=0; switches then produced 11→1, 10→0 and 00→0. Open in Circuit Lab navigated to `#/lab` and exposed the actual AND graph with two NAND gates, five wires, depth two and zero diagnostics. Its generated truth table produced 00→0, 01→0, 10→0 and 11→1.

On public `#/cpu`, the mandatory six-word addition program ran to Halted at cycle 6, with A=7, OUT=7, PC=0x05 and PC HOLD. The waveform panel contained 13 actual samples for CLK, A, PC, A.write and OUT. A hard reload of public `#/cpu` returned the transient machine to Ready while retaining the exact six-instruction source. Running again halted successfully, with accessible controls showing `PROGRAM COUNTER 0x05 HOLD` and I/O `0x00 → 0x07`. Console inspections before and after reload returned no warnings or errors; the first query requested up to 20 entries. This establishes the observed deployed workflows; it does not add another three-engine test run. [Public CPU screenshot](screenshots/public-cpu-lab.jpg), [deployment record](DEPLOYMENT.md#observed-publication).

A late review of primary Nand2Tetris, CircuitVerse, Logisim Evolution and Turing Complete sources is documented in [DESIGN_REFERENCES.md](DESIGN_REFERENCES.md). It occurred after implementation and does not claim their code or assets were used.
