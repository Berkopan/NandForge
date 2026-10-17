export interface ExampleProgram {
  id: string;
  name: string;
  nameTr: string;
  description: string;
  descriptionTr: string;
  source: string;
  expectedOutput: number;
  expectedOutputs: number[];
  input?: number;
}

export const EXAMPLE_PROGRAMS: ExampleProgram[] = [
  {
    id: 'add-two', name: 'Add Two Numbers', nameTr: 'İki Sayıyı Topla',
    description: 'The first complete program: store 3, add 4, and latch 7 in OUT.',
    descriptionTr: 'İlk tam program: 3 değerini sakla, 4 ekle ve OUT yazmacına 7 yaz.',
    source: `; Store the first number in RAM, then add the second.
LDI 3
STA 240
LDI 4
ADD 240
OUT
HLT`,
    expectedOutput: 7, expectedOutputs: [7],
  },
  {
    id: 'count-up', name: 'Count from Zero to Ten', nameTr: 'Sıfırdan Ona Say',
    description: 'A counted loop emits eleven values. SUB updates Z for the loop condition.',
    descriptionTr: 'Sayaç döngüsü on bir değer üretir. SUB, döngü koşulu için Z bayrağını günceller.',
    source: `; RAM locations used by this program.
.EQU COUNTER, 240
.EQU ONE, 241
.EQU LIMIT, 242
LDI 0
STA COUNTER
LDI 1
STA ONE
LDI 11
STA LIMIT
loop:
  LDA COUNTER
  OUT             ; Observe 0, 1, 2, ... 10.
  ADD ONE
  STA COUNTER
  SUB LIMIT       ; Compare the new counter with 11.
  JNZ loop
HLT`,
    expectedOutput: 10, expectedOutputs: Array.from({ length: 11 }, (_, i) => i),
  },
  {
    id: 'countdown', name: 'Countdown', nameTr: 'Geri Sayım',
    description: 'Count down to zero and inspect how SUB drives JNZ.',
    descriptionTr: 'Sıfıra kadar geri say ve SUB komutunun JNZ davranışını nasıl belirlediğini incele.',
    source: `LDI 1
STA 240
LDI 10
loop:
  OUT
  SUB 240         ; A = A - 1, C means no borrow.
  JNZ loop
OUT               ; Emit the final zero.
HLT`,
    expectedOutput: 0, expectedOutputs: Array.from({ length: 11 }, (_, i) => 10 - i),
  },
  {
    id: 'conditional', name: 'Conditional Branching', nameTr: 'Koşullu Dallanma',
    description: 'Subtract equal numbers and use the registered zero flag to choose a path.',
    descriptionTr: 'Eşit iki sayıyı çıkar ve yazmaçtaki sıfır bayrağıyla yürütülecek yolu seç.',
    source: `LDI 5
STA 240
LDI 5
SUB 240           ; A = 0, Z = 1, C = 1.
JZ equal
LDI 0             ; The unequal path is skipped.
OUT
HLT
equal:
  LDI 42
  OUT
  HLT`,
    expectedOutput: 42, expectedOutputs: [42],
  },
  {
    id: 'summation', name: 'Summation Loop', nameTr: 'Toplam Döngüsü',
    description: 'Sum integers 1 through 10 using a counter and a RAM accumulator.',
    descriptionTr: 'Bir sayaç ve RAM toplamıyla 1 ile 10 arasındaki tam sayıları topla.',
    source: `.EQU SUM, 240
.EQU COUNTER, 241
.EQU ONE, 242
LDI 0
STA SUM
LDI 10
STA COUNTER
LDI 1
STA ONE
loop:
  LDA SUM
  ADD COUNTER
  STA SUM
  LDA COUNTER
  SUB ONE
  STA COUNTER
  JNZ loop
LDA SUM
OUT               ; 1 + 2 + ... + 10 = 55.
HLT`,
    expectedOutput: 55, expectedOutputs: [55],
  },
  {
    id: 'fibonacci', name: 'Fibonacci Sequence', nameTr: 'Fibonacci Dizisi',
    description: 'Emit sixteen Fibonacci numbers. Values naturally wrap modulo 256.',
    descriptionTr: 'On altı Fibonacci sayısı üret. Değerler doğal olarak 256 modunda taşar.',
    source: `.EQU PREVIOUS, 240
.EQU CURRENT, 241
.EQU NEXT, 242
.EQU REMAINING, 243
.EQU ONE, 244
LDI 0
STA PREVIOUS
LDI 1
STA CURRENT
STA ONE
LDI 16
STA REMAINING
loop:
  LDA PREVIOUS
  OUT
  ADD CURRENT      ; 144 + 233 becomes 121 with C = 1.
  STA NEXT
  LDA CURRENT
  STA PREVIOUS
  LDA NEXT
  STA CURRENT
  LDA REMAINING
  SUB ONE
  STA REMAINING
  JNZ loop
HLT`,
    expectedOutput: 98, expectedOutputs: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 121, 98],
  },
  {
    id: 'bitwise', name: 'Bitwise Operations', nameTr: 'Bit İşlemleri',
    description: 'Follow the binary patterns through AND, NOT, shifts, OR and XOR.',
    descriptionTr: 'İkili desenleri AND, NOT, kaydırma, OR ve XOR işlemlerinde takip et.',
    source: `LDI 0b10101010
STA 240
LDI 0b11001100
AND 240            ; 10001000
NOT                ; 01110111
SHL                ; 11101110, C = 0
SHR                ; 01110111, C = 0
OR 240             ; 11111111
XOR 240            ; 01010101 = 85
OUT
HLT`,
    expectedOutput: 85, expectedOutputs: [85],
  },
  {
    id: 'input-output', name: 'Read Input and Write Output', nameTr: 'Girişi Oku ve Çıkışa Yaz',
    description: 'Set the input byte before IN. The output remains latched after OUT.',
    descriptionTr: 'IN öncesinde giriş baytını ayarla. OUT sonrasında çıkış yazmaçta tutulur.',
    source: `; Try changing the external input before the first step.
; IN samples it on the instruction's rising clock edge.
IN
OUT
HLT`,
    input: 42, expectedOutput: 42, expectedOutputs: [42],
  },
];
