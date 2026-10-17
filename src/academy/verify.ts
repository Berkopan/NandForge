import { compileCircuit, Simulator } from '../core';
import type { ChipDefinition, Circuit } from '../core/types';
import type { Lesson } from './lessons';
import type { Language } from '../i18n';

export interface VerificationResult { ok: boolean; tested: number; message: string; inputs?: Record<string, number>; expected?: Record<string, number>; actual?: Record<string, number> }

export function verifyLesson(lesson: Lesson, circuit: Circuit, chips: ChipDefinition[], language: Language = 'en'): VerificationResult {
  const tr = language === 'tr';
  let tested = 0;
  try {
    if (lesson.kind === 'program') return { ok: false, tested, message: tr ? 'Program görevini CPU ortamında doğrula.' : 'Verify the program challenge in the CPU environment.' };
    if (lesson.allowedTypes && circuit.components.some((c) => !lesson.allowedTypes!.includes(c.type))) return { ok: false, tested, message: tr ? 'Bu görevde yalnızca NAND, giriş, çıkış ve sabit bileşenlerini kullan. Davranışını ardından test edeceğiz.' : 'Use only NAND, input, output and constant components for this challenge. We will then test their behavior.' };
    const find = (name: string, type: 'INPUT' | 'OUTPUT', width: number) => {
      const matches = circuit.components.filter((c) => c.type === type && (c.label === name || c.id === `${type.toLowerCase()}-${name}`));
      if (matches.length !== 1) throw new Error(tr ? `${name} etiketli tek bir ${type} bileşeni gerekiyor.` : `Keep exactly one ${type} component named ${name}.`);
      const component = matches[0]!;
      if ((component.config.width ?? 1) !== width) throw new Error(tr ? `${name}, ${width} bit genişliğinde olmalı.` : `${name} must be ${width} bits wide.`);
      return component.id;
    };
    const inputs = Object.fromEntries(lesson.inputs.map((p) => [p.name, find(p.name, 'INPUT', p.width)]));
    const outputs = Object.fromEntries(lesson.outputs.map((p) => [p.name, find(p.name, 'OUTPUT', p.width)]));
    const simulator = new Simulator(compileCircuit(circuit, chips));
    const read = () => Object.fromEntries(Object.entries(outputs).map(([name, id]) => [name, simulator.read(id, 'in')]));
    const check = (values: Record<string, number>, expected: Record<string, number>): VerificationResult | null => {
      const actual = read(); tested++;
      if (Object.keys(expected).some((key) => actual[key] !== expected[key])) return { ok: false, tested, inputs: values, expected, actual, message: tr ? 'Bu giriş birleşiminde sonuç farklı. Bağlantıları ve pin genişliklerini kontrol et.' : 'This input combination produced a different result. Check your connections and pin widths.' };
      return null;
    };
    if (lesson.kind === 'sequential') {
      let expectedQ = simulator.read(outputs.Q!, 'in');
      for (const [value, enabled] of [[37, 1], [201, 0], [255, 1], [0, 1], [82, 0], [173, 1]]) {
        simulator.setInput(inputs.D!, value!); simulator.setInput(inputs.EN!, enabled!);
        const before = check({ D: value!, EN: enabled!, CLOCK_STEP: 0 }, { Q: expectedQ }); if (before) return before;
        simulator.step(); if (enabled) expectedQ = value!;
        const after = check({ D: value!, EN: enabled!, CLOCK_STEP: 1 }, { Q: expectedQ }); if (after) return after;
      }
    } else {
      const totalBits = lesson.inputs.reduce((sum, p) => sum + p.width, 0);
      const vectors: Record<string, number>[] = [];
      if (totalBits <= 9) {
        for (let n = 0; n < 2 ** totalBits; n++) {
          let value = n; const vector: Record<string, number> = {};
          for (const port of lesson.inputs) { vector[port.name] = value & (2 ** port.width - 1); value = Math.floor(value / 2 ** port.width); }
          vectors.push(vector);
        }
      } else {
        const boundaries = [0, 1, 2, 15, 16, 127, 128, 254, 255];
        for (const a of boundaries) for (const b of boundaries) for (const op of [0, 1]) vectors.push({ A: a, B: b, OP: op });
        let seed = 0x4e414e44;
        for (let n = 0; n < 256; n++) {
          const vector: Record<string, number> = {};
          for (const port of lesson.inputs) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; vector[port.name] = (seed >>> 12) & (2 ** port.width - 1); }
          vectors.push(vector);
        }
      }
      for (const values of vectors) {
        for (const [name, id] of Object.entries(inputs)) simulator.setInput(id, values[name]!);
        const failure = check(values, lesson.evaluate!(values)); if (failure) return failure;
      }
    }
    return { ok: true, tested, message: tr ? `${tested} gerçek davranış testi geçti. Devren beklenen işlevi gerçekleştiriyor.` : `${tested} real behavioral tests passed. Your circuit implements the expected function.` };
  } catch (error) {
    return { ok: false, tested, message: `${tr ? 'Devre henüz test edilemiyor' : 'The circuit cannot be tested yet'}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
