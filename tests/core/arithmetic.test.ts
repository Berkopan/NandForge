import { describe, expect, it } from 'vitest';
import { componentSimulator, rng } from './helpers';

describe('arithmetic constructed from NAND netlists', () => {
  it('exhausts half- and full-adder truth tables', () => {
    const half = componentSimulator('HALF_ADDER');
    const full = componentSimulator('FULL_ADDER');
    for (let a = 0; a <= 1; a++) for (let b = 0; b <= 1; b++) {
      half.setInputs({ a, b });
      expect(half.read('gate', 'sum')).toBe((a + b) & 1);
      expect(half.read('gate', 'carry')).toBe((a + b) >>> 1);
      for (let cin = 0; cin <= 1; cin++) {
        full.setInputs({ a, b, cin });
        expect(full.read('gate', 'sum')).toBe((a + b + cin) & 1);
        expect(full.read('gate', 'cout')).toBe((a + b + cin) >>> 1);
      }
    }
    expect(full.compiled.stats.gates).toBe(9);
  });

  it('exhausts all 8-bit addition and subtraction pairs including carry-in and borrow-in', () => {
    const adder = componentSimulator('ADDER', { width: 8 });
    const subtractor = componentSimulator('SUBTRACTOR', { width: 8 });
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) for (let cin = 0; cin <= 1; cin++) {
      adder.setInputs({ a, b, cin });
      const add = a + b + cin;
      // Throwing only on a mismatch keeps the exhaustive oracle economical and its vectors precise.
      if (adder.read('gate', 'sum') !== (add & 255) || adder.read('gate', 'cout') !== Number(add > 255)) throw new Error(`Addition mismatch at ${a},${b},${cin}`);
      subtractor.setInputs({ a, b, cin });
      const subtract = a - b - cin;
      if (subtractor.read('gate', 'sum') !== (subtract & 255) || subtractor.read('gate', 'cout') !== Number(subtract < 0)) throw new Error(`Subtraction mismatch at ${a},${b},${cin}`);
    }
  });

  it('compares all 8-bit unsigned operand pairs', () => {
    const comparator = componentSimulator('COMPARATOR', { width: 8 });
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
      comparator.setInputs({ a, b });
      if (comparator.read('gate', 'eq') !== Number(a === b) || comparator.read('gate', 'lt') !== Number(a < b) || comparator.read('gate', 'gt') !== Number(a > b)) throw new Error(`Comparison mismatch at ${a},${b}`);
    }
  });

  it('extends arithmetic to 16 bits with deterministic broad vectors and boundary carries', () => {
    const adder = componentSimulator('ADDER', { width: 16 });
    const subtractor = componentSimulator('SUBTRACTOR', { width: 16 });
    const comparator = componentSimulator('COMPARATOR', { width: 16 });
    const random = rng(987654321);
    const boundaries = [0, 1, 255, 256, 32767, 32768, 65534, 65535];
    const vectors = boundaries.flatMap(a => boundaries.map(b => [a, b] as const));
    for (let index = 0; index < 2048; index++) vectors.push([random() & 65535, random() & 65535]);
    for (const [a, b] of vectors) {
      for (let cin = 0; cin <= 1; cin++) {
        adder.setInputs({ a, b, cin });
        expect(adder.read('gate', 'sum')).toBe((a + b + cin) & 65535);
        expect(adder.read('gate', 'cout')).toBe(Number(a + b + cin > 65535));
        subtractor.setInputs({ a, b, cin });
        expect(subtractor.read('gate', 'sum')).toBe((a - b - cin) & 65535);
        expect(subtractor.read('gate', 'cout')).toBe(Number(a - b - cin < 0));
      }
      comparator.setInputs({ a, b });
      expect([comparator.read('gate', 'eq'), comparator.read('gate', 'lt'), comparator.read('gate', 'gt')]).toEqual([Number(a === b), Number(a < b), Number(a > b)]);
    }
  });
});
