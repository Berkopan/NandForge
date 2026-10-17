# Reproducible performance measurements

These measurements describe the real compiled simulator and debugger on one local Node runtime. They are not promises of a browser frame rate, a physical clock rate, or performance on another computer.

## Recorded run

Command: `npm run bench`

Recorded: **2026-10-17 19:16:30 UTC**. Environment: **Node v24.19.0**, Linux x64, reported **AMD EPYC 9V74 80-Core Processor**, with **9 logical CPUs** exposed to the environment. The JavaScript workloads below execute on one thread. The machine can be shared with other work, so timing variation is expected.

Each runtime result is the median of **three measured samples**. Compilation uses warmed built-in blueprints and excludes simulator allocation. Runtime excludes initial image loading. There is no DOM or React rendering in these measurements.

| Workload | Expanded NAND gates | Scheduled operations | Iterations | Median total | Approximate iterations/s | Median compilation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small: four-NAND XOR | 4 | 4 | 50,000 input updates | 12.263 ms | 4,077,319 | 0.117 ms |
| Medium: 16 layers × 32 NANDs | 512 | 513 | 10,000 input updates | 38.280 ms | 261,233 | 4.092 ms |
| Large: 64 layers × 128 NANDs | 8,192 | 8,193 | 1,000 input updates | 87.246 ms | 11,462 | 62.514 ms |
| CPU execution and state inspection | 1,477 | 897 | 12,003 instructions | 262.569 ms | 45,714 | 9.770 ms |
| CPU debugger, five probes, history and log | 1,477 | 897 | 5,000 instructions | 291.400 ms | 17,159 | Uses the same compiled CPU |

The CPU contains seven DFF word instances and one idealized RAM state instance. Its estimated combinational depth is 40 NAND/memory-read stages. The medium and large graph depths are 16 and 64 respectively.

Gate count and operation count differ because a width-eight NAND operation evaluates eight independent NAND gates together. SPLIT/JOIN and idealized memory reads are also scheduled operations. The simulator never executes CPU instruction handlers inside the operation loop.

### Individual runtime samples

| Workload | Sample 1 | Sample 2 | Sample 3 |
| --- | ---: | ---: | ---: |
| XOR | 16.199 ms | 12.263 ms | 11.745 ms |
| 512 NANDs | 38.838 ms | 37.138 ms | 38.280 ms |
| 8,192 NANDs | 87.246 ms | 86.639 ms | 110.898 ms |
| CPU execution | 261.968 ms | 272.975 ms | 262.569 ms |
| CPU debugger | 292.792 ms | 291.400 ms | 291.229 ms |

## What the workloads do

The small circuit cycles two inputs through all four combinations of an exposed four-NAND XOR. The larger circuits split a changing 16-bit input into single bits, then evaluate deterministic interconnected NAND layers with multiple output probes. These are complete reevaluations following input changes; repeatedly reading an unchanged value is not counted as useful work.

The CPU benchmark assembles this real program and executes it through `CpuMachine.step()`:

```asm
LDI 1
STA 240
LDI 0
loop: ADD 240
OUT
JMP loop
```

The initial three instructions prepare an increment of one. The following 12,000 instructions complete 4,000 three-instruction iterations. The benchmark checks the final output is **160**, equal to `4000 mod 256`, and the cycle count is exactly **12,003**. Each `CpuMachine.step()` also returns real register, control, and copied RAM state, so this measures the public execution adapter rather than only an isolated NAND inner loop.

The debugger workload executes 5,000 instructions through `DebuggerSession.step()`. Every cycle includes CPU state inspection, RAM change detection, two actual clock-phase samples, execution logging, and a full restorable CPU snapshot. Five probes observe CLK, A, PC, A.write, and OUT. It also verifies that both real clock levels were recorded and that backward/forward restoration returns to exactly the same machine snapshot.

## Bounded waveform and history storage

After sustained execution, the debugger retained:

| Item | Retained amount |
| --- | ---: |
| Waveform samples | 1,024 |
| Restorable snapshots | 256 |
| Execution log entries | 256 |
| UTF-8 JSON size of retained history, samples, and log | 1,144,239 bytes |

The serialized byte count is reproducible content size for this workload. It is **not** a JavaScript heap allocation measurement: object headers, shared values, temporary arrays, garbage collection, and browser engine choices affect actual heap use. Recording a larger number of probes or different values changes the serialized size; the item counts remain bounded.

## Interpretation and limits

The results show the implemented full-pass evaluator handles these hundreds- and thousands-of-gates workloads without requiring a separate interpreter shortcut. Dirty-state skipping avoids reevaluation for unchanged reads, and compact net indices avoid graph traversal during a step. Compiling a graph is more expensive than evaluating it, so editor position changes do not trigger recompilation.

These measurements exclude browser graph rendering, layout, canvas interaction, paint, animation, and application scheduling. A graph with 8,192 rendered nodes can have different UI costs from simulating 8,192 primitive gates inside an inspectable hierarchy. Main-thread execution is used; no Web Worker or per-net event-driven evaluator is claimed. Circuit placement, dependency shape, history recording, and the host environment all affect observed performance.

Re-run `npm run bench` on the target machine for its own results. The script emits structured JSON with actual environment details, individual timings, medians, circuit statistics, workload sizes, retention checks, and deterministic output checks. It fails rather than publishing measurements when CPU execution or history verification diverges.
