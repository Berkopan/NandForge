/** Bus words are unsigned integers. Analog and unknown (X/Z) states are not modelled. */
export function maskForWidth(width: number): number {
  if (!Number.isInteger(width) || width < 1 || width > 16) {
    throw new RangeError(`Bus width must be an integer from 1 through 16; received ${width}.`);
  }
  return (1 << width) - 1;
}

export function word(value: number, width: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError('Signal values must be safe integers.');
  return value & maskForWidth(width);
}

export function formatSignal(value: number, width: number, radix: 2 | 10 | 16 = 2): string {
  const normalized = word(value, width);
  if (radix === 10) return String(normalized);
  return normalized.toString(radix).toUpperCase().padStart(radix === 2 ? width : Math.ceil(width / 4), '0');
}
