# NandForge instruction set and assembly language

## Machine conventions

The CPU has an unsigned eight-bit accumulator A, an eight-bit program counter PC, Z/C flags, IN/OUT registers, 256 bytes of RAM and 256 sixteen-bit instruction words of ROM. A machine word is `(opcode << 8) | operand`. The operand byte is an immediate value or an address in the instruction's relevant address space.

All instructions execute in one atomic architectural clock step. Unless an instruction branches or stops the processor, PC becomes `(PC + 1) mod 256`. Instructions that write A set Z to one exactly when their result is zero. Instructions that do not write A preserve Z. Only ADD, SUB, SHL and SHR modify C.

Reset state is A=0, PC=0, Z=1, C=0, OUT=0, IN=0, HALTED=0 and FAULT=0. The loaded ROM and initial RAM image are restored by Reset.

## Instruction reference

Here, `M[x]` is RAM byte x; `n` and `addr` range from 0 through 255. Every result written into A is masked to eight bits.

| Opcode | Assembly | Effect | Z | C |
| --- | --- | --- | --- | --- |
| `00` | `NOP` | No data-state change | Preserved | Preserved |
| `01` | `LDI n` | A ← n | From A | Preserved |
| `02` | `LDA addr` | A ← M[addr] | From A | Preserved |
| `03` | `STA addr` | M[addr] ← A | Preserved | Preserved |
| `04` | `ADD addr` | A ← A + M[addr] | From A | 1 iff the full sum exceeds 255 |
| `05` | `SUB addr` | A ← A − M[addr] | From A | 1 iff original A ≥ M[addr], meaning no borrow |
| `06` | `AND addr` | A ← A AND M[addr] | From A | Preserved |
| `07` | `OR addr` | A ← A OR M[addr] | From A | Preserved |
| `08` | `XOR addr` | A ← A XOR M[addr] | From A | Preserved |
| `09` | `NOT` | A ← bitwise NOT A | From A | Preserved |
| `0A` | `SHL` | A ← A shifted left one; new bit 0 is 0 | From A | Original A bit 7 |
| `0B` | `SHR` | A ← A shifted right one; new bit 7 is 0 | From A | Original A bit 0 |
| `0C` | `JMP addr` | PC ← addr | Preserved | Preserved |
| `0D` | `JZ addr` | PC ← addr if stored Z=1; otherwise increment | Preserved | Preserved |
| `0E` | `JNZ addr` | PC ← addr if stored Z=0; otherwise increment | Preserved | Preserved |
| `0F` | `JC addr` | PC ← addr if stored C=1; otherwise increment | Preserved | Preserved |
| `10` | `OUT` | OUT ← A | Preserved | Preserved |
| `11` | `IN` | A ← current external input | From A | Preserved |
| `FF` | `HLT` | Latch HALTED, hold PC on this instruction | Preserved | Preserved |

Hex values in the first column are opcode bytes, not complete words. For example, `LDI 3` is `0x0103`, `STA 240` is `0x03F0`, and `HLT` is `0xFF00`.

The lower byte of a no-operand machine instruction is ignored by hardware. The assembler rejects an explicitly written operand for those mnemonics and emits a zero low byte.

### Arithmetic examples

| Operation | A result | Z | C |
| --- | --- | --- | --- |
| 255 + 1 | 0 | 1 | 1 |
| 127 + 128 | 255 | 0 | 0 |
| 0 − 1 | 255 | 0 | 0, a borrow occurred |
| 9 − 9 | 0 | 1 | 1, no borrow occurred |
| SHL of `10000001` | `00000010` | 0 | 1 |
| SHR of `00000001` | `00000000` | 1 | 1 |

There is no signed-overflow flag, rotate-through-carry, carry-in arithmetic instruction or direct compare instruction. To compare for equality, save a needed operand in RAM and use SUB followed by JZ/JNZ. SUB changes A.

### Reserved opcodes

All opcode bytes from `0x12` through `0xFE` are reserved. Encountering one holds PC and latches HALTED=1 and FAULT=1 in the same instruction step. No accumulator, flag, output or memory write occurs. Future `CpuMachine.step()` calls do not advance the clock or cycle counter until Reset or another program load.

## Assembly syntax

Mnemonics, labels and constants are case-insensitive. Symbols are returned in uppercase. Names begin with an ASCII letter or underscore and may continue with letters, digits or underscores. Labels end in a colon and name a ROM instruction address. Labels may precede an instruction on the same line; several labels may identify one location.

```asm
; Comments may start with a semicolon, // or #.
.EQU VALUE, 240
    LDI 0x07       ; hexadecimal
    STA VALUE
    JMP show       ; forward reference
show:
    LDA VALUE
    OUT
    HLT
```

Literal formats are decimal (`240`), hexadecimal (`0xF0`) and binary (`0b11110000`). Expressions support symbol references, parentheses, unary `+`/`-`, and addition/subtraction. Values must be exact JavaScript integers; context-specific range validation follows evaluation. Thus a negative intermediate expression may be valid, but `LDI -1` is rejected rather than silently wrapped.

```asm
BASE .EQU 0xF0
.EQU NEXT, BASE + 1
LDI (0b1000 + 2) - 1
STA NEXT
```

### Directives

| Directive | Purpose | Constraints |
| --- | --- | --- |
| `.ORG expression` | Move the ROM assembly location | Address 0–255; cannot overlap existing emitted instructions or depend on an unresolved forward label |
| `.EQU NAME, expression` | Define a constant | Does not emit a word; forward constant references allowed; cycles rejected |
| `NAME .EQU expression` | Alternate constant syntax | Same behavior as `.EQU NAME, expression` |
| `.WORD expression` | Emit a raw 16-bit ROM word | Value 0–65535; useful for encoding and reserved-opcode experiments |

```asm
JMP last
.ORG 255
last: HLT
```

Holes in ROM contain NOP. `.ORG` changes where code is emitted; it does not change the CPU's reset PC, which remains zero. Place a jump at address zero when the intended entry point is elsewhere.

Constants can refer forward to labels for instruction operands. `.ORG` is evaluated during address assignment and therefore requires a value resolvable at that point. A label cannot share a `.EQU` line. Duplicate symbols and overlapping ROM writes are errors.

## Assembler result and diagnostics

`assemble(source)` returns `{ ok, rom, listing, diagnostics, symbols }` without executing the program. ROM always has 256 words. A listing entry records the ROM address, encoded word, original source line, one-based line/column and mnemonic. Diagnostics include a stable category code, one-based line/column and a human-readable explanation.

A result is loadable only when `ok` is true. On failure, the listing and ROM may contain partial assembly for inspection; the IDE must keep the previous loaded program until errors are fixed. Unknown mnemonics, missing or extra operands, malformed numbers, undefined symbols, cyclic constants, address overlaps and ROM overflow receive positioned diagnostics.

To keep the browser responsive, source is limited to 200,000 characters and 10,000 lines, expressions to 256 tokens and 32 nesting levels, and constant dependency chains to 128 entries.

## Included programs

| Program | Observable OUT values |
| --- | --- |
| Add Two Numbers | 7 |
| Count from Zero to Ten | 0, 1, …, 10 |
| Countdown | 10, 9, …, 0 |
| Conditional Branching | 42 |
| Summation Loop | 55 |
| Fibonacci Sequence | 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 121, 98 |
| Bitwise Operations | 85 |
| Read Input and Write Output | The input value sampled by IN; the example starts at 42 |

These sources live in `src/assembler/examples.ts`. Automated tests assemble them, execute them through the real circuit CPU and verify each complete output sequence.
