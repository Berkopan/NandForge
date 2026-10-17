import type { Circuit, ComponentType } from '../core/types';
import { bilingual as b, type Localized } from '../i18n';

export interface LessonPort { name: string; width: number }
export interface Lesson {
  id: string;
  number: number;
  title: Localized;
  category: Localized;
  objective: Localized;
  foundation: Localized;
  instructions: Localized;
  expected: Localized;
  hint: Localized;
  inputs: LessonPort[];
  outputs: LessonPort[];
  kind: 'combinational' | 'sequential' | 'program';
  allowedTypes?: ComponentType[];
  seedGates?: ComponentType[];
  evaluate?: (values: Record<string, number>) => Record<string, number>;
}
const gates = b('01 / DIGITAL LOGIC', '01 / SAYISAL MANTIK');
const arithmetic = b('02 / DATA & ARITHMETIC', '02 / VERİ VE ARİTMETİK');
const computer = b('03 / THE COMPUTER', '03 / BİLGİSAYAR');
const one = (name: string): LessonPort => ({ name, width: 1 });
const bus = (name: string, width = 8): LessonPort => ({ name, width });
const nandOnly: ComponentType[] = ['INPUT', 'OUTPUT', 'NAND', 'CONST'];

export const LESSONS: Lesson[] = [
  {
    id: 'signals', number: 1, title: b('Make a connection', 'İlk bağlantını kur'), category: gates,
    objective: b('Make the output follow the input switch.', 'Çıkışın giriş anahtarını izlemesini sağla.'),
    foundation: b('A digital signal has two possible values: 0 and 1. A wire carries a value from an output pin to an input pin. It does not change that value.', 'Sayısal bir sinyalin iki olası değeri vardır: 0 ve 1. Bir bağlantı, değeri çıkış pininden giriş pinine taşır; değeri değiştirmez.'),
    instructions: b('Drag from the A output handle to the OUT input handle. Toggle A to predict both possible outputs, then verify.', 'A’nın çıkış pininden OUT’un giriş pinine sürükle. A’yı değiştirerek iki çıkışı da tahmin et, ardından doğrula.'),
    expected: b('A = 0 → OUT = 0. A = 1 → OUT = 1.', 'A = 0 → OUT = 0. A = 1 → OUT = 1.'),
    hint: b('A source handle is on the right of a component. A target handle is on the left.', 'Kaynak pini bileşenin sağında, hedef pini solundadır.'),
    inputs: [one('A')], outputs: [one('OUT')], kind: 'combinational', evaluate: ({ A = 0 }) => ({ OUT: A }),
  },
  {
    id: 'nand', number: 2, title: b('Meet the NAND gate', 'NAND kapısını tanı'), category: gates,
    objective: b('Wire a NAND gate and discover the one input combination that produces zero.', 'Bir NAND kapısı bağla ve sıfır üreten tek giriş birleşimini keşfet.'),
    foundation: b('NAND means “not both.” Its output is 0 only when both inputs are 1. NAND is functionally complete: networks of this one gate can express every Boolean function.', 'NAND, “ikisi birden değil” demektir. Çıkışı yalnızca iki giriş de 1 olduğunda 0 olur. Yalnızca NAND kapılarından oluşan ağlarla her Boole fonksiyonu kurulabilir.'),
    instructions: b('Connect A and B to the two NAND inputs, then connect its output to OUT. Try all four input combinations.', 'A ve B’yi NAND’ın iki girişine, çıkışını OUT’a bağla. Dört giriş birleşimini de dene.'),
    expected: b('00 → 1, 01 → 1, 10 → 1, 11 → 0.', '00 → 1, 01 → 1, 10 → 1, 11 → 0.'),
    hint: b('Each input must have exactly one driver. A single output may drive several inputs.', 'Her giriş tam olarak bir kaynaktan sürülmelidir. Bir çıkış birden fazla girişi sürebilir.'),
    inputs: [one('A'), one('B')], outputs: [one('OUT')], kind: 'combinational', seedGates: ['NAND'], evaluate: ({ A = 0, B = 0 }) => ({ OUT: 1 - (A & B) }),
  },
  {
    id: 'not', number: 3, title: b('Build NOT from NAND', 'NAND ile NOT oluştur'), category: gates,
    objective: b('Invert one input using only a NAND gate.', 'Yalnızca NAND kullanarak bir girişi tersle.'),
    foundation: b('When the two inputs to NAND are identical, “not both” becomes “not this.” Fan-out lets the same signal connect to both gate inputs.', 'NAND’ın iki girişi aynıysa “ikisi birden değil”, “bu değil” olur. Bir sinyalin iki girişe de bağlanmasına fan-out denir.'),
    instructions: b('Use INPUT, OUTPUT and NAND components only. Connect A to both NAND inputs. Send the result to OUT.', 'Yalnızca INPUT, OUTPUT ve NAND bileşenlerini kullan. A’yı NAND’ın iki girişine de bağla. Sonucu OUT’a gönder.'),
    expected: b('The output must always be the opposite of A.', 'Çıkış her zaman A’nın tersi olmalı.'),
    hint: b('NAND(A, A) = NOT(A). Two wires may start at the same output pin.', 'NAND(A, A) = NOT(A). İki bağlantı aynı çıkış pininden başlayabilir.'),
    inputs: [one('A')], outputs: [one('OUT')], kind: 'combinational', seedGates: ['NAND'], allowedTypes: nandOnly, evaluate: ({ A = 0 }) => ({ OUT: 1 - A }),
  },
  {
    id: 'and-or', number: 4, title: b('Build AND and OR', 'AND ve OR oluştur'), category: gates,
    objective: b('Produce both AND and OR from a network of NAND gates.', 'Bir NAND ağıyla hem AND hem OR çıktısı üret.'),
    foundation: b('Inverting NAND produces AND. De Morgan’s law says A OR B equals NOT(NOT A AND NOT B). This lets inverted inputs turn a NAND gate into OR.', 'NAND’ın çıkışını terslemek AND üretir. De Morgan yasasına göre A OR B, NOT(NOT A AND NOT B) ifadesine eşittir. Girişleri tersleyerek NAND’dan OR elde edebilirsin.'),
    instructions: b('Create two outputs, AND and OR, from the provided A and B switches. Build both paths using NAND components.', 'A ve B anahtarlarından AND ve OR etiketli iki çıkışı üret. İki yolu da NAND bileşenleriyle kur.'),
    expected: b('AND is 1 only for 11. OR is 0 only for 00.', 'AND yalnızca 11 için 1 olur. OR yalnızca 00 için 0 olur.'),
    hint: b('Use a NAND as an inverter by joining its inputs. AND needs two NAND gates; OR needs three.', 'NAND’ın iki girişini birleştirerek tersleyici yap. AND için iki, OR için üç NAND gerekir.'),
    inputs: [one('A'), one('B')], outputs: [one('AND'), one('OR')], kind: 'combinational', allowedTypes: nandOnly, evaluate: ({ A = 0, B = 0 }) => ({ AND: A & B, OR: A | B }),
  },
  {
    id: 'xor', number: 5, title: b('Find the difference: XOR', 'Farkı bul: XOR'), category: gates,
    objective: b('Build an output that is 1 when its inputs differ.', 'Girişler farklıysa 1 olan bir çıkış oluştur.'),
    foundation: b('Exclusive OR keeps the “either” part of OR but excludes “both.” XOR is also addition of two bits when carry is ignored.', 'Özel VEYA, OR’un “ikisinden biri” durumunu korur ama “ikisi de” durumunu dışlar. XOR aynı zamanda elde yok sayıldığında iki bitin toplamıdır.'),
    instructions: b('Use only NAND gates. Wire a network between A, B and OUT; inspect all four cases before verification.', 'Yalnızca NAND kapıları kullan. A, B ve OUT arasında bir ağ kur; doğrulamadan önce dört durumu incele.'),
    expected: b('00 → 0, 01 → 1, 10 → 1, 11 → 0.', '00 → 0, 01 → 1, 10 → 1, 11 → 0.'),
    hint: b('Let N = NAND(A,B). Then OUT = NAND(NAND(A,N), NAND(B,N)).', 'N = NAND(A,B) olsun. OUT = NAND(NAND(A,N), NAND(B,N)).'),
    inputs: [one('A'), one('B')], outputs: [one('OUT')], kind: 'combinational', allowedTypes: nandOnly, evaluate: ({ A = 0, B = 0 }) => ({ OUT: A ^ B }),
  },
  {
    id: 'half-adder', number: 6, title: b('Your first arithmetic circuit', 'İlk aritmetik devren'), category: arithmetic,
    objective: b('Build a half adder with a sum and a carry output.', 'Toplam ve elde çıkışı olan bir yarım toplayıcı kur.'),
    foundation: b('Adding 1 and 1 gives binary 10. The low bit is SUM; the high bit is CARRY. XOR computes the low bit, while AND detects the carry.', '1 ile 1’in toplamı ikilik 10’dur. Düşük bit SUM, yüksek bit CARRY olur. Düşük biti XOR hesaplar, eldeyi AND belirler.'),
    instructions: b('Connect A and B to a network that drives SUM and CARRY. You can compose the gates you already learned.', 'A ve B’yi SUM ve CARRY çıkışlarını süren bir ağa bağla. Öğrendiğin kapıları birleştirebilirsin.'),
    expected: b('SUM = (A + B) mod 2. CARRY = 1 only when A + B = 2.', 'SUM = (A + B) mod 2. CARRY yalnızca A + B = 2 olduğunda 1 olur.'),
    hint: b('Route A and B to both an XOR and an AND. One pair of inputs feeds two independent functions.', 'A ve B’yi hem XOR’a hem AND’e bağla. Aynı giriş çifti iki bağımsız fonksiyonu besler.'),
    inputs: [one('A'), one('B')], outputs: [one('SUM'), one('CARRY')], kind: 'combinational', evaluate: ({ A = 0, B = 0 }) => ({ SUM: A ^ B, CARRY: A & B }),
  },
  {
    id: 'full-adder', number: 7, title: b('Carry it forward', 'Eldeyi sonraki bite taşı'), category: arithmetic,
    objective: b('Add A, B and an incoming carry.', 'A, B ve gelen elde bitini topla.'),
    foundation: b('A full adder accepts the carry from the previous bit. Chaining full adders makes an arithmetic circuit for wider numbers.', 'Tam toplayıcı önceki bitten gelen eldeyi kabul eder. Tam toplayıcıları zincirleyerek daha geniş sayıları toplayan bir devre kurabilirsin.'),
    instructions: b('Provide SUM and COUT for all eight combinations of A, B and CIN. Try composing two half adders and an OR gate.', 'A, B ve CIN’in sekiz birleşimi için SUM ve COUT üret. İki yarım toplayıcı ve bir OR kapısını birleştirmeyi dene.'),
    expected: b('SUM is the low bit of A + B + CIN; COUT is the high bit.', 'SUM, A + B + CIN’in düşük biti; COUT ise yüksek bitidir.'),
    hint: b('First add A and B. Add that sum to CIN. OR the two carry results.', 'Önce A ile B’yi topla. Toplamı CIN ile topla. İki elde sonucunu OR’dan geçir.'),
    inputs: [one('A'), one('B'), one('CIN')], outputs: [one('SUM'), one('COUT')], kind: 'combinational', evaluate: ({ A = 0, B = 0, CIN = 0 }) => ({ SUM: (A + B + CIN) & 1, COUT: (A + B + CIN) >> 1 }),
  },
  {
    id: 'mux', number: 8, title: b('Choose a path', 'Bir yol seç'), category: arithmetic,
    objective: b('Build a 2-to-1 multiplexer.', '2’ye 1 çoklayıcı oluştur.'),
    foundation: b('A multiplexer chooses one of several data inputs. A CPU uses these choices to select an operand, a register value or its next instruction address.', 'Çoklayıcı, veri girişlerinden birini seçer. CPU bu seçimlerle bir operandı, yazmaç değerini veya sonraki komut adresini belirler.'),
    instructions: b('When SEL is 0, OUT must follow A. When SEL is 1, it must follow B.', 'SEL 0 iken OUT, A’yı izlemeli. SEL 1 iken B’yi izlemeli.'),
    expected: b('OUT = (A AND NOT SEL) OR (B AND SEL).', 'OUT = (A AND NOT SEL) OR (B AND SEL).'),
    hint: b('Mask each data input with its selection condition, then combine the two paths.', 'Her veri girişini seçim koşuluyla maskele, ardından iki yolu birleştir.'),
    inputs: [one('A'), one('B'), one('SEL')], outputs: [one('OUT')], kind: 'combinational', evaluate: ({ A = 0, B = 0, SEL = 0 }) => ({ OUT: SEL ? B : A }),
  },
  {
    id: 'bus-adder', number: 9, title: b('Think in buses', 'Bus ile düşün'), category: arithmetic,
    objective: b('Add two 4-bit buses and an incoming carry.', 'İki 4 bitlik bus ile gelen eldeyi topla.'),
    foundation: b('A bus carries multiple bits as one typed signal. Four bits represent values from 0 to 15; the fifth result bit becomes carry. Width is part of each connection’s contract.', 'Bus, birden fazla biti tek bir tür belirtilmiş sinyalde taşır. Dört bit 0–15 değerlerini temsil eder; sonucun beşinci biti elde olur. Genişlik, her bağlantının sözleşmesinin parçasıdır.'),
    instructions: b('Configure a multi-bit adder to width 4, or build one from full adders, splitters and joiners. Connect A, B, CIN, SUM and COUT.', 'Çok bitli toplayıcıyı 4 bit genişliğe ayarla veya tam toplayıcılar, ayırıcılar ve birleştiricilerle kur. A, B, CIN, SUM ve COUT’u bağla.'),
    expected: b('15 + 1 = SUM 0, COUT 1. Verification checks all 512 input combinations.', '15 + 1 = SUM 0, COUT 1. Doğrulama 512 giriş birleşiminin tamamını denetler.'),
    hint: b('The sum bus must be 4 bits, but CIN and COUT remain 1 bit.', 'Toplam bus’ı 4 bit olmalı; CIN ve COUT ise 1 bit kalır.'),
    inputs: [bus('A', 4), bus('B', 4), one('CIN')], outputs: [bus('SUM', 4), one('COUT')], kind: 'combinational', evaluate: ({ A = 0, B = 0, CIN = 0 }) => ({ SUM: (A + B + CIN) & 15, COUT: (A + B + CIN) >> 4 }),
  },
  {
    id: 'register', number: 10, title: b('Remember a byte', 'Bir baytı hatırla'), category: computer,
    objective: b('Store an 8-bit input only on a rising clock edge when enabled.', '8 bitlik girişi yalnızca etkin durumdaki yükselen saat kenarında sakla.'),
    foundation: b('Combinational logic answers “what is the value now?” A register remembers a previous value. All flip-flops sample the same pre-edge state, so a clock gives sequential circuits a precise update boundary.', 'Kombinasyonel mantık “şu anda değer ne?” sorusunu yanıtlar. Yazmaç geçmişteki değeri hatırlar. Tüm flip-flop’lar kenardan önceki aynı durumu örnekler; böylece saat, ardışıl devrelere kesin bir güncelleme sınırı verir.'),
    instructions: b('Use an 8-bit REGISTER. Connect D, EN and CLK; connect q to Q. Changing D without a clock edge must leave Q unchanged.', '8 bitlik REGISTER kullan. D, EN ve CLK’yi bağla; q çıkışını Q’ya bağla. Saat kenarı olmadan D değişirse Q sabit kalmalı.'),
    expected: b('EN = 1: the next rising edge stores D. EN = 0: all clock steps retain Q.', 'EN = 1: sonraki yükselen kenar D’yi saklar. EN = 0: saat adımları Q’yu değiştirmez.'),
    hint: b('Choose width 8 in the register inspector. CLK and EN are always 1-bit signals.', 'Yazmaç denetçisinde genişliği 8 seç. CLK ve EN her zaman 1 bitlik sinyallerdir.'),
    inputs: [bus('D'), one('EN')], outputs: [bus('Q')], kind: 'sequential', seedGates: ['REGISTER'],
  },
  {
    id: 'alu', number: 11, title: b('One unit, two operations', 'Tek birim, iki işlem'), category: computer,
    objective: b('Build an 8-bit ALU that selects ADD or XOR.', 'ADD veya XOR seçebilen 8 bitlik bir ALU oluştur.'),
    foundation: b('An arithmetic logic unit computes several candidate results. Control signals select the one that reaches the register. The CPU’s larger ALU follows the same principle.', 'Aritmetik mantık birimi birden fazla aday sonuç hesaplar. Kontrol sinyalleri yazmaca ulaşacak sonucu seçer. CPU’nun daha büyük ALU’su da aynı ilkeyi izler.'),
    instructions: b('When OP = 0, output A + B modulo 256. When OP = 1, output A XOR B. Configure each data path to 8 bits.', 'OP = 0 iken A + B’nin mod 256 sonucunu üret. OP = 1 iken A XOR B üret. Her veri yolunu 8 bit olarak ayarla.'),
    expected: b('255 + 1 wraps to 0; 0xF0 XOR 0x0F is 255. Boundary and deterministic hidden vectors test both operations.', '255 + 1, 0’a sarar; 0xF0 XOR 0x0F, 255’tir. Sınır durumları ve deterministik gizli vektörler iki işlemi de test eder.'),
    hint: b('Compute ADD and XOR in parallel, then use an 8-bit MUX controlled by OP.', 'ADD ve XOR’u paralel hesapla; ardından OP ile kontrol edilen 8 bitlik bir MUX kullan.'),
    inputs: [bus('A'), bus('B'), one('OP')], outputs: [bus('OUT')], kind: 'combinational', evaluate: ({ A = 0, B = 0, OP = 0 }) => ({ OUT: OP ? A ^ B : (A + B) & 255 }),
  },
  {
    id: 'first-program', number: 12, title: b('Give your computer a program', 'Bilgisayarına program ver'), category: computer,
    objective: b('Assemble and execute a program that adds 3 and 4, outputs 7, and halts.', '3 ile 4’ü toplayan, 7 çıktısı veren ve duran bir program derleyip çalıştır.'),
    foundation: b('An instruction is a 16-bit word: an 8-bit opcode and an 8-bit operand. ROM supplies that word to a real decoder, which drives the ALU, memory and register writes.', 'Bir komut 16 bitlik bir sözcüktür: 8 bit işlem kodu ve 8 bit operand. ROM bu sözcüğü gerçek bir kod çözücüye verir; kod çözücü ALU’yu, belleği ve yazmaç yazımlarını kontrol eder.'),
    instructions: b('Write LDI 3; STA 240; LDI 4; ADD 240; OUT; HLT on separate lines. Assemble & load, step through the instructions, then verify.', 'Ayrı satırlara LDI 3; STA 240; LDI 4; ADD 240; OUT; HLT yaz. Derle ve yükle; komutları adımla ve ardından doğrula.'),
    expected: b('The real CPU reaches HALT with output 7. Watch A change from 3 to 4 to 7.', 'Gerçek CPU, çıkış 7 iken HALT durumuna ulaşır. A’nın 3’ten 4’e, ardından 7’ye değişimini izle.'),
    hint: b('STA saves A into RAM. ADD reads the chosen RAM address. OUT latches A into a separate output register.', 'STA, A’yı RAM’e kaydeder. ADD, seçilen RAM adresini okur. OUT, A’yı ayrı bir çıkış yazmacına aktarır.'),
    inputs: [], outputs: [], kind: 'program',
  },
];

export function createLessonCircuit(lesson: Lesson): Circuit {
  const components: Circuit['components'] = [];
  for (const [index, port] of lesson.inputs.entries()) components.push({ id: `input-${port.name}`, type: 'INPUT', label: port.name, position: { x: 50, y: 80 + index * 125 }, config: { width: port.width, value: 0 } });
  for (const [index, port] of lesson.outputs.entries()) components.push({ id: `output-${port.name}`, type: 'OUTPUT', label: port.name, position: { x: 630, y: 100 + index * 155 }, config: { width: port.width, display: port.width === 1 ? 'led' : 'hex' } });
  for (const [index, type] of (lesson.seedGates ?? []).entries()) components.push({ id: `gate-${index}`, type, position: { x: 330, y: 140 + index * 140 }, config: { width: type === 'REGISTER' ? 8 : 1 } });
  if (lesson.kind === 'sequential') components.push({ id: 'clock', type: 'CLOCK', label: 'CLK', position: { x: 50, y: 340 }, config: {} });
  return { id: `lesson-${lesson.id}`, name: lesson.title.en, description: lesson.objective.en, version: 1, components, connections: [] };
}
