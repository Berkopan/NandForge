# Implementation and acceptance status

**Verified 2026-10-17:** 218 unit tests and 60 production-browser executions passed; global typecheck and lint are clean. All A–N acceptance, remote CI, Pages publication and public-site browser verification are complete.

Target: **Berkopan/NandForge**, asset base **`/NandForge/`**, verified public URL **https://berkopan.github.io/NandForge/**. The [machine-readable ledger](implementation-status.json) records the same evidence.

## Verification

| Check | Observed result | Evidence |
| --- | --- | --- |
| Unit suite (local) | **218 passed / 17 files**, reported duration 1.72 s | [Tests](../tests/), `npm test`; includes ordinary-HTTP identifier regression |
| TypeScript | **Passed** | `npm run typecheck`, [strict configuration](../tsconfig.json) |
| ESLint | **Passed** | `npm run lint`, [scripts](../package.json) |
| Production build | **Passed**, tested asset `index-B85FVxlb.js` | `npm run build`, [base configuration](../vite.config.ts) |
| Chromium / Firefox / WebKit (local) | **60 passed: 20 per engine**, 73.60569 s; 0 unexpected, flaky or skipped | [CPU scenarios](../tests/e2e/cpu.spec.ts), [workspace scenarios](../tests/e2e/workflows.spec.ts), [runner](../playwright.config.ts) |
| Public browser smoke | Home and Circuit Lab AND table passed; CPU **A=7, OUT=7, cycle=6, PC=0x05 HOLD** | [Observed workflows](DEPLOYMENT.md#observed-publication), [public CPU screenshot](screenshots/public-cpu-lab.jpg) |
| Visual QA | **Five final captures checked**; desktop 1440×1000 and mobile 390×844 viewports | [Screenshots](screenshots/), [README gallery](../README.md#screenshots), [Turkish gallery](../README.tr.md) |
| Remote CI | **Passed**, 14/14 steps; remote **218 units / 2.82 s**, **60 browser executions / 2.1 min** | [Actions run 39064679103](https://github.com/Berkopan/NandForge/actions/runs/39064679103), [validation job](https://github.com/Berkopan/NandForge/actions/runs/39064679103/job/117489719266) |
| GitHub Pages | **Publication passed, 4/4 steps**; exact public URL and browser smoke verified | [Publication job](https://github.com/Berkopan/NandForge/actions/runs/39064679103/job/117490439008), [deployment guide](DEPLOYMENT.md); source already GitHub Actions |

Local and remote browser counts describe separate complete runs; they are not added together. It includes share-URL import, exact NAND-XOR inspection, English/Turkish workflows, Academy reset and queued-timer/manual-stop regressions. [Detailed audit](ENGINEERING_AUDIT.md).

## A–N acceptance

| ID | Required behavior | Status | Concrete evidence |
| --- | --- | --- | --- |
| A | Two switch inputs and AND produce all four correct results | **Verified** | [Gate tests](../tests/core/combinational.test.ts), [browser construction/wiring](../tests/e2e/workflows.spec.ts) |
| B | NAND-built XOR has outputs 0,1,1,0 and inspectable four-NAND internals | **Verified** | [NAND blueprints](../src/core/chips.ts), [three-engine XOR table and inspection](../tests/e2e/workflows.spec.ts) |
| C | Saved chips expose typed ports and execute their internal graph in other circuits | **Verified** | [Chip extraction/reuse](../tests/editor/model.test.ts), [hierarchy](../tests/core/hierarchy.test.ts), [browser reuse](../tests/e2e/workflows.spec.ts) |
| D | Register data edits hold Q until an enabled edge | **Verified** | [Atomic state tests](../tests/core/sequential.test.ts), [browser register hold/enable](../tests/e2e/workflows.spec.ts) |
| E | Eight-bit arithmetic handles carry, borrow and wraparound | **Verified** | [131,072 vectors per ADDER/SUBTRACTOR](../tests/core/arithmetic.test.ts), [CPU ALU](../tests/cpu/alu.test.ts) |
| F | The actual circuit CPU computes 3 + 4 and OUT=7 | **Verified** | [Generic-Simulator and changed-wire proof](../tests/core/cpu-integrity.test.ts), [browser execution](../tests/e2e/cpu.spec.ts) |
| G | Loops and branches update PC using registered flags | **Verified** | [12,288 differential transitions](../tests/cpu/cpu.test.ts), [test-only reference](../tests/cpu/reference.ts), [browser loop](../tests/e2e/cpu.spec.ts) |
| H | Breakpoints stop before instructions; rewind restores complete state | **Verified** | [Debugger tests](../tests/debugger/session.test.ts), [browser breakpoint/rewind/timer controls](../tests/e2e/cpu.spec.ts) |
| I | Clock, register and control probes contain actual recorded values | **Verified** | [Phase/export tests](../tests/debugger/session.test.ts), [browser exported capture](../tests/e2e/cpu.spec.ts) |
| J | Academy success comes from the circuit's outputs | **Verified** | [Candidate-circuit checks](../tests/academy/verify.test.ts), [wired verification/reset/progress](../tests/e2e/workflows.spec.ts) |
| K | Save/reload/export/import preserve topology and behavior | **Verified** | [JSON/sharing](../tests/persistence/projects.test.ts), [draft recovery](../tests/persistence/draft-storage.test.ts), [IndexedDB/share-URL browser round trips](../tests/e2e/workflows.spec.ts) |
| L | English and Turkish cover major interfaces and lessons | **Verified** | [CPU translations](../src/i18n/cpu.ts), [lessons](../src/academy/lessons.ts), [bilingual CPU/Academy and language-return workflow](../tests/e2e/workflows.spec.ts) |
| M | Correct project base and verified public Pages deployment | **Verified** | [Successful CI/publication](https://github.com/Berkopan/NandForge/actions/runs/39064679103), [actual public Home/Circuit Lab/CPU checks](DEPLOYMENT.md#observed-publication) |
| N | Actual tests, type checker, linter and build run with accurate reporting | **Verified** | Completed local results above; [performance measurements](BENCHMARKS.md), [execution audit](ENGINEERING_AUDIT.md) |

## Scope and delivery evidence

The shared engine uses explicit clocks, unsigned 1–16-bit signals and declared idealized DFF/RAM/ROM boundaries. CPU logic executes the actual NAND-derived graph. Projects persist definitions and source; live registers, probes and debugger history are transient across route unmount/reload. [Architecture](ARCHITECTURE.md), [semantics](SIMULATION.md).

The five README PNGs show the verified production interface; a sixth capture records the public CPU result. Primary educational-tool sources were reviewed **after implementation**; [DESIGN_REFERENCES.md](DESIGN_REFERENCES.md) records that chronology and the independent implementation choices.

Delivery is verified at the exact public URL: complete AND table, real six-cycle CPU result, and successful `#/cpu` hard reload with source retained and the program runnable again. Console inspections returned no warnings/errors. No acceptance or deployment evidence remains pending.

Brief provenance: user-supplied `Yapıştırılan metin(20261017-184928).txt`, section 17 scenarios A–N; the explicit repository correction determines `/NandForge/`. The private brief is not reproduced in this repository.
