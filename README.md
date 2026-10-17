# NandForge

### Build a computer. Understand every bit.

**[Türkçe](README.tr.md)** · **[GitHub Pages](https://berkopan.github.io/NandForge/)** · **[Architecture](docs/ARCHITECTURE.md)** · **[Instruction set](docs/ISA.md)** · **[Contributing](docs/CONTRIBUTING.md)**

NandForge is a browser-based digital engineering playground. Connect NAND gates, build reusable chips, inspect clocked state, and program an eight-bit computer whose instructions execute through the same circuit simulator used by the visual editor.

The application runs in your browser without an account, backend, API key, or external compute service. Projects and progress are stored on your device. English is the default interface language; Turkish is available from the header.

## Explore the application

| Workspace | What you can do |
| --- | --- |
| **Circuit Lab** | Place components, connect explicitly typed pins, toggle inputs, inspect values, build custom chips, and measure actual compiled circuit complexity. |
| **CPU Lab** | Assemble programs, follow the live datapath, inspect registers and RAM, set breakpoints and watchpoints, and restore execution snapshots. |
| **Academy** | Complete twelve challenges whose verification runs the circuit you actually built. |
| **Projects** | Create, rename, duplicate, reopen, import, export, and share browser-local projects. Start from thirteen working circuit templates. |
| **Documentation** | Read the model's boundaries, instruction reference, architecture, and operating instructions. |

The home page also includes an interactive two-NAND AND circuit. Its switches and output use the real simulation engine.

## Screenshots

Captured from the production application under `/NandForge/`.

![CPU Lab with assembly source, live datapath, OUT equal to 7, and recorded waveforms](docs/screenshots/cpu-lab-desktop.png)

*The 3 + 4 program has halted after six cycles. PC is held at the HLT instruction, OUT retains 7, and the waveforms show the actual execution.*

<details>
<summary>Home, Circuit Lab, Academy, and mobile screenshots</summary>

### Circuit Lab

![Half adder with both inputs high, sum 0, carry 1, and its complete four-row truth table](docs/screenshots/circuit-lab-desktop.png)

*The editor, typed pin inspector, and truth table observe the same running circuit.*

### Home

![NandForge home page with the interactive NAND-based AND circuit](docs/screenshots/home-desktop.png)

### Academy

![Academy learning path with twelve circuit and programming challenges](docs/screenshots/academy-desktop.png)

### CPU Lab on mobile

![Mobile CPU Lab after the input/output example halted with OUT equal to 42](docs/screenshots/cpu-lab-mobile.png)

*The input/output example runs through the same circuit CPU at a 390-pixel viewport.*

</details>

## Start locally

Use **Node.js 24** and npm. The repository's CI uses the same Node major version.

```sh
git clone https://github.com/Berkopan/NandForge.git
cd NandForge
npm ci
npm run dev
```

Open **[http://localhost:4173/NandForge/](http://localhost:4173/NandForge/)**. The capital **N** and **F** are intentional: the repository is `Berkopan/NandForge`, and the deployment base is `/NandForge/`.

### Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server on port 4173. |
| `npm run typecheck` | Strict TypeScript checking, including indexed access checks. |
| `npm run lint` | ESLint across source, tests, and configuration. |
| `npm test` | Simulator, arithmetic, assembler, CPU, editor, Academy, debugger, and persistence tests. |
| `npm run test:watch` | Rerun unit tests while editing. |
| `npm run build` | Typecheck, then generate production assets in `dist/`. |
| `npm run preview` | Serve the production build for inspection. |
| `npm run test:e2e` | Playwright browser workflows against the production build on port 4174. |
| `npm run bench` | Reproducible simulator and debugger benchmarks with structured results. |

Install Playwright's browser before running browser tests:

```sh
npm run build
npx playwright install chromium
npm run test:e2e
```

For the Chromium, Firefox, and WebKit projects used by CI:

```sh
npx playwright install --with-deps chromium firefox webkit
PLAYWRIGHT_ALL_BROWSERS=1 npm run test:e2e
```

## Build your first circuit

1. Open **Projects → New project**, or choose **Your first AND gate** from the template collection.
2. In **Circuit Lab**, add two **Switch** components, an **AND** gate, and an **LED**. Click a palette item to place it, or drag it onto the grid.
3. Connect the first switch's `out` pin to the gate's `a` pin, and the second switch to `b`. Connect the gate's `out` to the LED's `in`.
4. Toggle the switches. The LED becomes `1` only when both inputs are `1`.
5. Open **Truth table → Generate truth table** to evaluate every input combination with the actual simulator.
6. Select the AND gate and choose **Open internal circuit** to see the two NAND gates that implement it.

Output pins are on the right, input pins on the left. A source can drive several inputs; each input can have only one driver. Matching bit widths are required. You can also select a component and use each input's **Connect** selector in the inspector, which provides a keyboard-accessible wiring method.

### The component library

| Category | Components |
| --- | --- |
| Inputs and outputs | Switch, momentary button, clock, constant, LED, binary display, hexadecimal display, seven-segment display. |
| Logic gates | NAND, NOT, AND, OR, NOR, XOR, XNOR, buffer. |
| Arithmetic | Half adder, full adder, ripple-carry adder, subtractor, unsigned comparator. |
| Routing | Multiplexer, demultiplexer, decoder, bus splitter, bus joiner. |
| Sequential | D flip-flop, enabled register, counter. |
| Memory | Idealized RAM and ROM with editable initial contents. |
| Custom | Reusable chips saved with the project, including nested chip instances. |

Buses support **1–16 bits**. The inspector exposes signal width, labels, initial values, display format, and memory configuration where applicable. Multi-bit inputs accept unsigned decimal values. Signal inspection also shows binary and hexadecimal forms. Splitter/joiner pin `b0` is the least significant bit. Seven-segment displays show hexadecimal digits.

### Editing and observation

- Pan and zoom the canvas, fit the complete circuit, arrange its layout, and toggle grid snapping or the minimap.
- Select multiple components with **Shift + drag**, or add components to a selection with **Shift**, **Ctrl**, or **⌘**.
- Copy, paste, duplicate, delete, and undo graph changes. Deleting a component also removes its incident connections.
- Read current values on pins and selected wires. High signals carry both a distinct color and a visible numeric value.
- Open the diagnostics dock for disconnected inputs, width mismatches, multiple drivers, malformed modules, and unsupported combinational loops.
- Inspect compiled NAND gate count, connection count, state-element count, and combinational depth. Depth is a logical measure; it does not represent physical timing.

The main shortcuts are:

| Action | Shortcut |
| --- | --- |
| Undo / redo | `Ctrl/⌘ Z` / `Ctrl/⌘ Shift Z` |
| Copy / paste / duplicate | `Ctrl/⌘ C` / `Ctrl/⌘ V` / `Ctrl/⌘ D` |
| Select all | `Ctrl/⌘ A` |
| Delete selection | `Delete` or `Backspace` |
| Run / pause circuit | `Space` |
| Fit circuit | `F` |
| Move selection | Arrow keys; `Alt` uses a one-unit increment |
| Save project | `Ctrl/⌘ S` |

Editing shortcuts leave text fields available for normal text editing. The context menu provides the corresponding graph actions.

### Reusable chips and live internal inspection

Select **Save as chip**, provide a name, and choose the entire circuit or a selection. Existing INPUT and OUTPUT components become typed module ports. For a selection, connections crossing its boundary become explicit input/output ports; shared sources retain fan-out. A chip must contain valid executable logic and at least one output.

The saved definition appears under **My chips**. Place instances, wire their named ports, and use them like built-in components. New projects inherit a copy of the active project's custom-chip library; duplicating a project carries its definitions too. Each project's definitions travel with its JSON, so sharing a project includes its reusable logic.

**Open internal circuit** reads the actual selected instance through its hierarchical simulator path. Two instances can hold different register or memory values, and inspection preserves that distinction. Parent editor layers remain mounted, preserving their state and undo history. Internal inspection is read-only; return to the parent circuit to change inputs or advance its clock.

## How the simulation works

The React interface does not execute logic. [`src/core/`](src/core/) is a pure TypeScript simulation engine with no DOM dependency:

1. The compiler validates components, pins, widths, drivers, and module boundaries.
2. Hierarchical chips expand to a common representation. Combinational built-ins reduce to NAND operations; splitters and joiners represent bus wiring.
3. Dependency analysis establishes a deterministic combinational order. Unsupported combinational cycles are rejected, while feedback through clocked state is allowed.
4. The simulator evaluates compact indexed signals. Unchanged reads skip reevaluation; changed inputs trigger deterministic recomputation.
5. A clock step samples the stable pre-edge values, commits the affected state elements together, and reevaluates combinational logic.
6. Serializable snapshots preserve inputs, sequential state, memories, clocks, and cycle count for exact restoration.

A normal clock step emits a complete **low → high → low** pulse. Waveform observers can sample both real edge phases. Changing a data input while paused does not implicitly clock a register.

The model uses two-valued unsigned digital signals. D flip-flops and memory are explicit idealized primitives. There is no analog voltage model, transistor simulation, or propagation-delay claim. See [Simulation semantics](docs/SIMULATION.md) for exact clock, memory, loop, hierarchy, and validation rules.

## A real eight-bit CPU

NandForge's accumulator computer is a hierarchical circuit built with the same components and compiler as Circuit Lab. Instruction ROM drives the instruction decoder, control equations, ALU, registers, program counter, and memory write controls. [`CpuMachine`](src/cpu/machine.ts) wraps the shared simulator and reads actual signals; it does not dispatch opcodes to a JavaScript instruction interpreter.

| Part | Capacity or behavior |
| --- | --- |
| Accumulator and program counter | 8 bits each. |
| Flags | Stored Zero `Z` and Carry `C`. |
| Input and output | Held external input byte; separately latched output register. |
| Data RAM | 256 × 8 bits. |
| Instruction ROM | 256 × 16 bits. |
| Instruction encoding | Upper byte: opcode. Lower byte: immediate value or address. |
| Execution | One instruction per atomic rising clock edge. |
| Halt and fault | HLT holds the instruction address; reserved opcodes latch a visible fault. |

The compiled CPU contains **1,477 single-bit NAND gates**. Multi-bit NANDs are evaluated in word operations, so gate count and scheduled operation count differ. The measured configuration and reproducible methodology are recorded in [Benchmarks](docs/BENCHMARKS.md).

### First program: 3 + 4

Open **CPU Lab**, choose **Add Two Numbers**, then select **Assemble & load** if you edited the source. Step through the instructions or press Run:

```asm
LDI 3
STA 240
LDI 4
ADD 240
OUT
HLT
```

`STA 240` saves the first number in RAM. `ADD 240` adds it to the accumulator. `OUT` latches the result, **7**, and `HLT` stops execution.

The ISA contains `NOP`, `LDI`, `LDA`, `STA`, `ADD`, `SUB`, `AND`, `OR`, `XOR`, `NOT`, `SHL`, `SHR`, `JMP`, `JZ`, `JNZ`, `JC`, `OUT`, `IN`, and `HLT`. The assembler supports labels, comments, decimal/hexadecimal/binary literals, expressions, `.EQU`, `.ORG`, and `.WORD`, with line/column diagnostics and an address-to-source listing.

Arithmetic wraps modulo 256. ADD sets Carry on overflow; CPU SUB sets Carry when no unsigned borrow occurs. SHL/SHR store the shifted-out bit in Carry. Instructions that write A update Zero; other operations preserve flags unless explicitly specified. The standalone SUBTRACTOR component exposes **borrow-out**, which differs from the CPU SUB instruction's **no-borrow Carry** convention. See the [complete ISA](docs/ISA.md) and [CPU architecture](docs/CPU.md).

Eight sample programs cover addition, counting up, countdown, branching, summation, Fibonacci, bitwise operations, and external input/output.

### Debugging and waveforms

- Click source line numbers or machine-code addresses to set breakpoints. Run stops before executing the breakpoint instruction; continuing can execute it.
- Add a RAM watchpoint by address or by clicking a memory cell. Run stops after the watched location changes.
- Inspect A, PC, flags, OUT, input, RAM, current instruction, register write enables, branch selection, and ALU selection.
- Step backward or forward through recorded snapshots, or use the history slider/cards to restore a state. Resuming from an earlier state creates a new execution branch; its old future is discarded.
- Add output or subsystem-pin probes. Inspect actual clock, register, bus, and control samples with a timeline cursor, zoom, horizontal scrolling, and JSON export.
- Use `Ctrl/⌘ Enter` to assemble and load, `F10` to step, `Shift F10` to step backward, and `F5` to run/pause.

CPU history and execution logs retain **256** entries each. Waveforms retain the newest **1,024** samples; the CPU allows up to **24** simultaneous probes. CPU runs stop after **100,000** instructions without another stop condition. Circuit Lab runs pause after **10,000** clock steps. These bounds prevent unbounded recording and accidental endless execution; Run can continue after the limit.

Circuit undo/redo changes the circuit document. CPU history restores simulation state. They are separate mechanisms.

## Learn by building

The Academy progresses through twelve challenges:

1. Make a connection.
2. Meet NAND.
3. Build NOT from NAND.
4. Build AND and OR.
5. Build XOR.
6. Build a half adder.
7. Build a full adder.
8. Build a multiplexer.
9. Add buses.
10. Store a byte in a clocked register.
11. Build an ALU that selects ADD or XOR.
12. Assemble and run the first CPU program.

Each challenge supplies an explanation, editable starter, expected behavior, hints, and feedback. Verification runs your actual circuit across exhaustive or deterministic test vectors, including enable/clock sequences for the register. Component names alone do not satisfy a challenge. NAND-only exercises also enforce their allowed component set. A lesson circuit can be continued as a sandbox project; progress is saved locally.

## Projects, portability, and privacy

Projects contain a versioned circuit graph, chip definitions, assembly source, and metadata. Browser storage uses IndexedDB; preferences and lesson progress use local storage. Changes autosave, and Save / `Ctrl/⌘ S` requests an immediate save.

Use **Export JSON** for a portable copy. **Import JSON** validates the document and creates a separate local project. The import limit is **4 MiB**, with additional graph, nesting, and expansion limits. Imported content is data; it is never evaluated as JavaScript.

For small projects, **Copy share link** compresses the project into the URL fragment. The dialog displays the URL before copying and offers manual selection/copy if clipboard access is unavailable. The link contains the project itself; it does not upload it to a hosting API. Encoded payloads are limited to **12,000 characters**, and decompression is bounded by the project import limit. Larger projects use JSON files.

Export preserves circuit topology, configurations, custom chips, and assembly. Live simulator state and temporary debugger history are not project-save fields; use waveform export for captured observations. Browser storage is specific to the browser/profile/origin. Export files when you need a backup or another device.

## Verification and performance

The test suite covers primitive truth tables, NAND composition, arithmetic, buses, validation, hierarchy, edge semantics, memory, deterministic snapshots, editor graph operations, Academy verification, persistence, and debugger state restoration.

CPU verification uses a separate reference implementation under [`tests/cpu/reference.ts`](tests/cpu/reference.ts), which is never imported into browser runtime. Tests include every opcode, exhaustive byte-pair addition/subtraction, deterministic instruction-by-instruction CPU comparisons, and the full output sequences of the example programs. Browser tests exercise user workflows against the built application under `/NandForge/`.

Benchmarks exercise four-NAND XOR, 512- and 8,192-gate networks, CPU execution, and sustained waveform/history recording. See [the measured results and limitations](docs/BENCHMARKS.md); these are measurements of one runtime and are not universal browser-FPS or hardware-frequency guarantees.

## Deployment

The [GitHub Actions workflow](.github/workflows/ci.yml) validates pushes and pull requests. A successful run on the repository's default branch uploads `dist/` and deploys through GitHub Pages. Pull-request validation does not deploy.

**CI and Pages publication succeeded on 17 October 2026:** [run 39064679103](https://github.com/Berkopan/NandForge/actions/runs/39064679103) validated final code `fcb591e` and completed the Pages deployment. The validation job passed all 14 steps; publication passed all 4. Pages already uses GitHub Actions; no owner setting change is needed. **[https://berkopan.github.io/NandForge/](https://berkopan.github.io/NandForge/)** also passed a deployed browser check: Home and Circuit Lab produced the complete correct AND truth table, and the actual CPU halted after six cycles with A=7, OUT=7 and PC=0x05. [Public execution evidence](docs/DEPLOYMENT.md#observed-publication). Static routes use URL hashes, such as `#/cpu`.

For another hosting path, set `NANDFORGE_BASE` when building and verify the resulting assets at that path. Full instructions are in [Deployment](docs/DEPLOYMENT.md).

## Technical boundaries

The circuit canvas is designed primarily for desktop use. Responsive controls, collapsible panels, direct pin selectors, and read-only CPU inspection provide smaller-screen alternatives. Large rendered graphs can cost more than the corresponding compiled simulation. Execution remains on the browser's main thread; this release does not claim Web Worker execution or physical timing simulation.

Automatic truth tables are limited to combinational circuits with at most eight input bits and a bounded operation budget. Wider/stateful circuits use direct inputs, clocks, probes, and the dedicated behavioral tests.

## Source map

```text
src/core/         Pure circuit schema, component library, compiler, simulator
src/editor/       Graph editing, inspector, chip creation, waveform UI
src/cpu/          Circuit-based ALU, decoder, control, registers, CPU adapter
src/assembler/    Parser, expressions, symbols, assembler, example programs
src/debugger/     CPU workspace, breakpoints, watchpoints, bounded history
src/academy/      Lessons and actual-circuit verification
src/persistence/  Versioned projects, validation, browser storage, sharing
src/i18n/         Shared English/Turkish interface and template text
src/views/        Home, Academy, Projects, documentation
tests/            Unit, exhaustive, differential, and browser verification
docs/             Architecture, semantics, ISA, benchmarks, deployment
```

The stack is TypeScript, React, Vite, React Flow, Lucide, Vitest, and Playwright. Styling uses maintainable plain CSS, with no backend or account system.

Contributions are welcome. Start with [Contributing](docs/CONTRIBUTING.md), [Architecture](docs/ARCHITECTURE.md), and the [shared contracts](docs/CONTRACTS.md). NandForge is released under the [MIT License](LICENSE).
