# The NandForge 8-bit computer

The CPU executes through the same deterministic digital simulator used by Circuit Lab. Its ROM feeds a hierarchical circuit containing real instruction decoding, Boolean control equations, a NAND-derived ALU, enabled registers, flags, a program counter and RAM. There is no runtime opcode interpreter.

## Architectural state

| State | Width | Reset | Meaning |
| --- | --- | --- | --- |
| A | 8 bits | 0 | Accumulator |
| PC | 8 bits | 0 | Address of the instruction currently presented by ROM |
| Z | 1 bit | 1 | Most recent A-writing instruction produced zero |
| C | 1 bit | 0 | Carry, no-borrow or shifted-out bit, as defined by the instruction |
| OUT | 8 bits | 0 | Latched output register |
| IN | 8 bits | 0 | Externally held user input; sampled by `IN` |
| HALTED | 1 bit | 0 | Clocking through the CPU adapter is stopped |
| FAULT | 1 bit | 0 | A reserved opcode was encountered |
| RAM | 256 × 8 bits | Loaded initial RAM image | Byte-addressed data memory |
| ROM | 256 × 16 bits | Loaded program image | Fixed-length instructions |

All numbers are unsigned. Arithmetic and normal PC increments wrap modulo 256. ROM and RAM are separate address spaces. A program cannot write ROM with `STA`.

The input byte is the simulator's externally controlled `INPUT` source, held until the user changes it. Changing IN while paused does not change A. The `IN` instruction copies the currently presented byte into the accumulator at its rising edge. OUT consists of enabled D flip-flops, so later changes to A or IN do not affect it.

## Instruction format and execution

Every instruction is one 16-bit ROM word:

| Bits | Field |
| --- | --- |
| 15–8 | Opcode |
| 7–0 | Immediate value or RAM/ROM address |

The low byte is ignored by instructions without an operand. The assembler emits zero for that byte. Unused ROM addresses contain the all-zero `NOP` word. CPU addresses count instructions, not bytes.

One CPU step performs one complete instruction as an atomic rising edge:

1. PC addresses ROM; the current instruction settles through the decoder and control unit.
2. RAM presents its byte at the operand address. The ALU computes all candidate results and selects one through a MUX tree.
3. Control signals determine which registers and memory locations will change. Conditional jumps use the currently stored Z and C flags.
4. On the rising edge, every enabled register and RAM write samples the same pre-edge state.
5. The simulator applies all state changes together and reevaluates the combinational network for the next instruction.
6. The clock returns low. A second observation can record that actual falling level without executing a second instruction.

The stable values displayed after a step therefore describe the newly stored state and the instruction now at PC. A combinational value may change even when its destination's write enable is zero. This is expected electrical behavior: observing an ALU result does not mean it was committed into A.

## Hierarchical implementation

`src/cpu/architecture.ts` exports `buildCpuCircuit()`, which returns the exact `Circuit` and `ChipDefinition[]` accepted by the shared compiler and editor.

| Subsystem | Top-level node | Actual implementation |
| --- | --- | --- |
| Instruction decoder | `decoder` | A splitter separates opcode and operand; shared bit inversions and nineteen balanced AND trees implement opcode minterms; OR trees produce validity |
| Control unit | `control` | Boolean gates combine decoded instructions, stored flags and halt/fault state into write enables, branch selection and an ALU operation bus |
| ALU | `alu` | Ripple-carry adders, reusable bitwise gates, wiring-based shifts and multiplexers |
| Register bank | `registers` | A, Z, C, HALT and FAULT; each enabled register expands to a feedback MUX and ideal D flip-flops |
| Program counter | `pc` | An eight-bit incrementer, target MUX and enabled PC register |
| Flag logic | `flags` | Balanced OR reduction plus inversion for zero; carry routing |
| Data memory | `ram` | Ideal RAM with combinational reads and atomic edge-triggered writes |
| Program memory | `rom` | Ideal combinational instruction ROM |
| Input/output | `io` | External input bus and an eight-bit enabled output register |

Combinational built-ins recursively expand to NAND components in the common compiler. Splitters and joiners represent wiring. D flip-flops, RAM, ROM, clocks and user input are the explicitly idealized boundaries. This is a two-valued digital circuit model; it does not claim transistor timing or analog accuracy.

### ALU operation bus

| Operation | Result | Carry candidate |
| --- | --- | --- |
| 0 | Immediate operand | 0 |
| 1 | RAM byte | 0 |
| 2 | A + RAM, low 8 bits | Unsigned overflow |
| 3 | A + NOT(RAM) + 1, low 8 bits | One when no unsigned borrow |
| 4 | A AND RAM | 0 |
| 5 | A OR RAM | 0 |
| 6 | A XOR RAM | 0 |
| 7 | NOT A | 0 |
| 8 | A shifted left one bit | Original A bit 7 |
| 9 | A shifted right one bit | Original A bit 0 |
| 10 | External input | 0 |
| 11–15 | 0 | 0 |

The carry candidate becomes architectural C only when `cWrite` is one. Consequently loads and bitwise operations preserve C even though their candidate carry is zero.

### Control signals

The simulator exposes `active`, `aWrite`, `zWrite`, `cWrite`, `ramWrite`, `outWrite`, `pcWrite`, `branch`, `haltWrite`, `faultWrite` and `aluOp` on the `control` component. Every write enable is gated by processor activity and opcode validity.

`zWrite` follows `aWrite`. `cWrite` is enabled only for ADD, SUB, SHL and SHR. `branch` is the actual taken-branch signal, not merely an indication that the current mnemonic is a jump. `active` becomes zero after HALT or FAULT is latched.

## Halt, fault and reset

`HLT` holds PC on the HLT instruction and latches HALTED. Its transition counts as one executed cycle. Subsequent `CpuMachine.step()` calls produce no clock pulse and leave the cycle count unchanged.

Every opcode outside the documented ISA holds PC, latches both HALTED and FAULT, and suppresses A, Z, C, OUT and RAM writes. This preserves the offending instruction for inspection. There is no fallback interpretation of reserved opcodes.

Reset clears registers and cycle count, restores Z to one, restores the initially loaded RAM image, clears input, and keeps the loaded program. `load(rom, ram?)` validates both images before changing any state, then performs a reset. A failed load preserves the running machine.

## Runtime and observation API

`CpuMachine` wraps only the shared `Simulator`. Its `state` getter reads actual component pins and copies RAM; it maintains no parallel register values or instruction execution state. ROM and initial RAM copies are retained solely to define Reset.

```ts
import { assemble } from '../src/assembler';
import { CpuMachine } from '../src/cpu';

const program = assemble('LDI 3\nSTA 240\nLDI 4\nADD 240\nOUT\nHLT');
if (!program.ok) throw new Error(program.diagnostics[0]?.message);

const cpu = new CpuMachine();
cpu.load(program.rom);
while (!cpu.state.halted) cpu.step();
console.log(cpu.state.output); // 7, obtained from the circuit's output register
```

For custom probes, `simulator.read(nodeId, pin)` reads named subsystem pins. Top-level OUTPUT nodes include `A`, `PC`, `Z`, `C`, `OUT`, `IN`, `HALTED`, `FAULT`, `OPCODE`, `OPERAND`, `ALU_RESULT` and `ALU_CARRY`. `step(observer)` forwards the simulator's real `rising` and `falling` phase callbacks.

Snapshots are plain serializable data containing the core simulator snapshot, loaded ROM and initial RAM. Restoring a snapshot restores real sequential state, memory, inputs, clocks and cycle count. Backward stepping uses restoration; it does not attempt to invert instructions. See the debugger implementation for bounded history and branch-after-rewind behavior.

## Verification

The CPU-specific suite is under `tests/cpu/`:

- Every one of the 256 opcode bytes is compared with an independent reference model, including all reserved opcodes.
- ADD and SUB each cover every one of the 65,536 possible byte pairs and their carry/no-borrow results.
- NOT and both shifts cover all 256 input bytes; deterministic bitwise vectors exercise independent source selection.
- Ninety-six deterministic programs provide 12,288 instruction-by-instruction comparisons of PC, A, flags, complete RAM, output, input, halted/fault state and cycle count.
- Each of the eight shipped examples is assembled and run on the gate circuit; tests check its complete OUT sequence.
- Additional cases cover branch conditions, carry preservation, PC wrap, RAM boundaries, input sampling, latched output, atomic loads, halt, reset, JSON snapshot restoration and real clock phases.

The separate interpreter is in `tests/cpu/reference.ts`. Browser code never imports it. Run `npm test -- tests/cpu` to repeat this verification. Timing results depend on the execution environment and are not processor-frequency guarantees.
