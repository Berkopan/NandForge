import { ALU_OPERATIONS, INSTRUCTIONS_BY_OPCODE, type Mnemonic } from '../cpu/isa';
import type { Language } from './index';

const labels = {
  accumulator: { en: 'ACCUMULATOR', tr: 'AKÜMÜLATÖR' },
  zero: { en: 'ZERO', tr: 'SIFIR' },
  carry: { en: 'CARRY', tr: 'ELDE' },
  zeroSignal: { en: 'zero', tr: 'sıfır' },
  carrySignal: { en: 'carry', tr: 'elde' },
  hold: { en: 'HOLD', tr: 'TUT' },
  fault: { en: 'FAULT', tr: 'HATA' },
  halt: { en: 'HALT', tr: 'DURDU' },
  branch: { en: 'BRANCH', tr: 'DALLAN' },
  aluSelection: { en: 'ALU', tr: 'ALU seçimi' },
  binary: { en: 'BINARY', tr: 'İKİLİ' },
  hexadecimal: { en: 'Hex', tr: 'Onaltılık' },
  decimal: { en: 'Decimal', tr: 'Onluk' },
} as const;

export function cpuText(language: Language, key: keyof typeof labels): string {
  return labels[key][language];
}

const operationsTr: Record<(typeof ALU_OPERATIONS)[number], string> = {
  Immediate: 'Sabit değer',
  RAM: 'RAM verisi',
  Add: 'Toplama',
  Subtract: 'Çıkarma',
  AND: 'Bit düzeyinde VE',
  OR: 'Bit düzeyinde VEYA',
  XOR: 'Bit düzeyinde ÖZEL VEYA',
  NOT: 'Bitleri tersleme',
  'Shift left': 'Sola kaydırma',
  'Shift right': 'Sağa kaydırma',
  Input: 'Harici giriş',
};

export function aluOperationName(language: Language, operation: number): string {
  const name = ALU_OPERATIONS[operation];
  return name === undefined ? '—' : language === 'tr' ? operationsTr[name] : name;
}

const instructionsTr: Record<Mnemonic, string> = {
  NOP: 'Yazmaçları ve bayrakları değiştirmeden sonraki komuta ilerle.',
  LDI: 'Komuttaki sabit baytı A yazmacına yükle. Z bayrağı, yüklenen değerin sıfır olup olmadığını kaydeder.',
  LDA: 'Belirtilen RAM adresindeki baytı A yazmacına yükle ve Z bayrağını güncelle.',
  STA: 'A yazmacındaki baytı belirtilen RAM adresine yaz. A ve bayraklar korunur.',
  ADD: 'RAM’deki baytı A ile topla; sonucun düşük 8 bitini A’ya yaz. C, işaretsiz taşmayı; Z, sonucun sıfır olduğunu belirtir.',
  SUB: 'RAM’deki baytı A’dan çıkar; sonucun düşük 8 bitini A’ya yaz. Ödünç gerekmediyse C = 1 olur; Z, sonucun sıfır olduğunu belirtir.',
  AND: 'A ile RAM’deki bayta bit düzeyinde VE uygula. Sonucu A’ya yaz ve Z bayrağını güncelle; C korunur.',
  OR: 'A ile RAM’deki bayta bit düzeyinde VEYA uygula. Sonucu A’ya yaz ve Z bayrağını güncelle; C korunur.',
  XOR: 'A ile RAM’deki bayta bit düzeyinde ÖZEL VEYA uygula. Sonucu A’ya yaz ve Z bayrağını güncelle; C korunur.',
  NOT: 'A yazmacındaki her biti tersle ve Z bayrağını güncelle. C bayrağı korunur.',
  SHL: 'A’yı bir bit sola kaydır; bit 0’a sıfır yaz. Önceki bit 7, C bayrağına geçer; Z sonuçtan güncellenir.',
  SHR: 'A’yı bir bit sağa kaydır; bit 7’ye sıfır yaz. Önceki bit 0, C bayrağına geçer; Z sonuçtan güncellenir.',
  JMP: 'Program sayacına belirtilen komut adresini yükle. A ve bayraklar korunur.',
  JZ: 'Kayıtlı Z bayrağı 1 ise belirtilen komut adresine atla; değilse sonraki komuta ilerle.',
  JNZ: 'Kayıtlı Z bayrağı 0 ise belirtilen komut adresine atla; değilse sonraki komuta ilerle.',
  JC: 'Kayıtlı C bayrağı 1 ise belirtilen komut adresine atla; değilse sonraki komuta ilerle.',
  OUT: 'A yazmacındaki baytı çıkış yazmacına al. OUT, başka bir OUT komutuna kadar bu değeri tutar.',
  IN: 'Yükselen saat kenarında harici giriş baytını A’ya al ve Z bayrağını güncelle. C korunur.',
  HLT: 'CPU’yu durdur ve program sayacını bu komutta tut. Yazmaçlar, RAM ve çıkış değerleri korunur.',
};

export function instructionDescription(language: Language, opcode: number): string {
  const instruction = INSTRUCTIONS_BY_OPCODE.get(opcode);
  if (!instruction) return language === 'tr'
    ? 'Ayrılmış işlem kodu: sonraki yükselen kenarda hata kaydedilir ve CPU durur. Program sayacı korunur; veri yazmaları engellenir.'
    : 'Reserved opcode: the next edge latches a processor fault.';
  return language === 'tr' ? instructionsTr[instruction.mnemonic] : instruction.description;
}
