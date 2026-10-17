import type { CpuState } from '../cpu';
import type { Language } from '../i18n';

const hex = (value: number, digits = 2) => `0x${value.toString(16).padStart(digits, '0').toUpperCase()}`;
const blocks = [
  { id: 'pc', x: 32, y: 36, title: 'PROGRAM COUNTER', tr: 'PROGRAM SAYACI', symbol: 'PC' },
  { id: 'rom', x: 277, y: 36, title: 'INSTRUCTION ROM', tr: 'KOMUT ROM', symbol: '256 × 16' },
  { id: 'decoder', x: 522, y: 36, title: 'DECODER', tr: 'KOD ÇÖZÜCÜ', symbol: 'OP + ARG' },
  { id: 'registers', x: 32, y: 194, title: 'REGISTER BANK', tr: 'YAZMAÇ KÜMESİ', symbol: 'A · Z · C' },
  { id: 'alu', x: 277, y: 194, title: 'ARITHMETIC / LOGIC', tr: 'ARİTMETİK / MANTIK', symbol: '8-BIT ALU' },
  { id: 'control', x: 522, y: 194, title: 'CONTROL UNIT', tr: 'KONTROL BİRİMİ', symbol: 'WRITE · SELECT' },
  { id: 'io', x: 32, y: 352, title: 'INPUT / OUTPUT', tr: 'GİRİŞ / ÇIKIŞ', symbol: 'IN → OUT' },
  { id: 'ram', x: 277, y: 352, title: 'DATA MEMORY', tr: 'VERİ BELLEĞİ', symbol: '256 × 8' },
  { id: 'flags', x: 522, y: 352, title: 'FLAG LOGIC', tr: 'BAYRAK MANTIĞI', symbol: 'ZERO · CARRY' },
];

export function CpuDiagram({ state, language, selected, onSelect }: { state: CpuState; language: Language; selected: string; onSelect: (id: string) => void }) {
  const values: Record<string, string> = {
    pc: `${hex(state.pc)} · ${state.control.pcWrite ? `→ ${hex(state.nextPc)}` : language === 'tr' ? 'TUT' : 'HOLD'}`, rom: hex(state.instruction, 4), decoder: `${hex(state.opcode)} | ${hex(state.operand)}`,
    registers: `A ${hex(state.a)} · Z${state.z} C${state.c}`, alu: `${hex(state.aluResult)} · C${state.aluCarry}`,
    control: state.fault ? 'FAULT' : state.halted ? 'HALT' : `ALU ${state.control.aluOp} · ${state.control.branch ? 'BRANCH' : 'PC + 1'}`,
    io: `${hex(state.input)} → ${hex(state.output)}`, ram: `[${hex(state.operand)}] = ${hex(state.ram[state.operand] ?? 0)}`, flags: `zero ${state.aluResult === 0 ? 1 : 0} · carry ${state.aluCarry}`,
  };
  const active: Record<string, boolean> = {
    pc: !!state.control.pcWrite, rom: !!state.control.active, decoder: !!state.control.active,
    registers: !!state.control.aWrite, alu: !!state.control.aWrite, control: !!state.control.active,
    io: !!state.control.outWrite || state.opcode === 0x11, ram: !!state.control.ramWrite || [2,4,5,6,7,8].includes(state.opcode), flags: !!state.control.zWrite || !!state.control.cWrite,
  };
  const paths = [
    { id: 'fetch', d: 'M222 78H277', on: !!state.control.active, label: hex(state.pc), x: 247, y: 65 },
    { id: 'decode', d: 'M467 78H522', on: !!state.control.active, label: '16', x: 494, y: 65 },
    { id: 'decode-control', d: 'M617 122V194', on: !!state.control.active, label: 'OP', x: 632, y: 162 },
    { id: 'reg-alu', d: 'M222 236H277', on: !!state.control.aWrite, label: 'A', x: 247, y: 224 },
    { id: 'control-alu', d: 'M522 236H467', on: !!state.control.aWrite, label: 'SEL', x: 494, y: 224 },
    { id: 'ram-alu', d: 'M372 352V280', on: active.ram!, label: '8', x: 386, y: 321 },
    { id: 'alu-reg', d: 'M321 194V156H127V194', on: !!state.control.aWrite, label: 'RESULT → A', x: 221, y: 146 },
    { id: 'reg-io', d: 'M127 280V352', on: !!state.control.outWrite, label: 'OUT', x: 149, y: 321 },
    { id: 'alu-flags', d: 'M467 266H495V394H522', on: !!state.control.zWrite || !!state.control.cWrite, label: 'Z / C', x: 473, y: 335 },
    { id: 'reg-ram', d: 'M222 267H249V394H277', on: !!state.control.ramWrite, label: 'STORE', x: 226, y: 332 },
  ];
  return <svg className="cpu-diagram" viewBox="0 0 746 458" role="group" aria-label={language === 'tr' ? 'Gerçek CPU veri ve kontrol yolları' : 'Real CPU datapath and control signals'}>
    <defs><pattern id="cpu-grid" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#26384e" /></pattern></defs>
    <rect width="746" height="458" fill="url(#cpu-grid)" />
    {paths.map((path) => <g key={path.id} className={path.on ? 'datapath is-active' : 'datapath'}><path d={path.d} /><text x={path.x} y={path.y} textAnchor="middle">{path.label}</text></g>)}
    {blocks.map((block) => <g key={block.id} className={`cpu-block ${active[block.id] ? 'active' : ''} ${selected === block.id ? 'selected' : ''}`}
      role="button" tabIndex={0} aria-label={`${language === 'tr' ? block.tr : block.title}: ${values[block.id]}`} aria-pressed={selected === block.id}
      onClick={() => onSelect(block.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(block.id); } }}>
      <rect x={block.x} y={block.y} width={190} height={86} rx={8} />
      <text className="block-heading" x={block.x + 13} y={block.y + 21}>{language === 'tr' ? block.tr : block.title}</text>
      <text className="block-symbol" x={block.x + 13} y={block.y + 43}>{block.symbol}</text>
      <text className="block-value" x={block.x + 13} y={block.y + 69}>{values[block.id]}</text>
      <circle cx={block.x + 173} cy={block.y + 19} r={3} fill={active[block.id] ? 'var(--cyan)' : '#3a4960'} />
    </g>)}
  </svg>;
}
