/** Independent test oracle. This file is never imported by browser/runtime code. */
export class ReferenceMachine {
  a = 0;
  pc = 0;
  z = 1;
  c = 0;
  output = 0;
  input = 0;
  halted = false;
  fault = false;
  cycles = 0;
  readonly rom: number[];
  readonly ram: number[];

  constructor(rom: readonly number[], ram: readonly number[] = []) {
    this.rom = Array.from({ length: 256 }, (_, i) => rom[i] ?? 0);
    this.ram = Array.from({ length: 256 }, (_, i) => ram[i] ?? 0);
  }

  step(): void {
    if (this.halted || this.fault) return;
    const word = this.rom[this.pc] ?? 0;
    const op = word >>> 8;
    const operand = word & 255;
    const memory = this.ram[operand] ?? 0;
    let nextPc = (this.pc + 1) & 255;
    let writesA = false;
    this.cycles += 1;
    switch (op) {
      case 0x00: break;
      case 0x01: this.a = operand; writesA = true; break;
      case 0x02: this.a = memory; writesA = true; break;
      case 0x03: this.ram[operand] = this.a; break;
      case 0x04: {
        const sum = this.a + memory;
        this.c = Number(sum > 255);
        this.a = sum % 256;
        writesA = true;
        break;
      }
      case 0x05: {
        this.c = Number(this.a >= memory);
        this.a = (this.a - memory + 256) % 256;
        writesA = true;
        break;
      }
      case 0x06: this.a &= memory; writesA = true; break;
      case 0x07: this.a |= memory; writesA = true; break;
      case 0x08: this.a ^= memory; writesA = true; break;
      case 0x09: this.a = 255 - this.a; writesA = true; break;
      case 0x0a: this.c = Number(this.a >= 128); this.a = (this.a * 2) % 256; writesA = true; break;
      case 0x0b: this.c = this.a % 2; this.a = Math.floor(this.a / 2); writesA = true; break;
      case 0x0c: nextPc = operand; break;
      case 0x0d: if (this.z) nextPc = operand; break;
      case 0x0e: if (!this.z) nextPc = operand; break;
      case 0x0f: if (this.c) nextPc = operand; break;
      case 0x10: this.output = this.a; break;
      case 0x11: this.a = this.input; writesA = true; break;
      case 0xff: this.halted = true; nextPc = this.pc; break;
      default: this.halted = true; this.fault = true; nextPc = this.pc; break;
    }
    if (writesA) this.z = Number(this.a === 0);
    this.pc = nextPc;
  }
}
