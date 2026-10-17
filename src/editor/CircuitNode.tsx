import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Clock3, Cpu, Database, Radio, ToggleLeft, Waves } from 'lucide-react';
import type { Component, ComponentSpec } from '../core/types';
import { editorText, translatedComponentLabels, type EditorLanguage } from './i18n';
import { formatSignal } from './model';

export interface CircuitNodeData extends Record<string, unknown> {
  component: Component;
  spec: ComponentSpec;
  values: Record<string, number | undefined>;
  language: EditorLanguage;
  invalid: boolean;
  invalidPins: string[];
  canSimulate: boolean;
  readOnly: boolean;
  onInput(nodeId: string, value: number): void;
}

export type CircuitFlowNode = Node<CircuitNodeData, 'circuit'>;

const SEVEN_SEGMENT = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

function SevenSegment({ value, width }: { value: number | undefined; width: number }) {
  const digits = value === undefined ? ' '.repeat(Math.ceil(width / 4)) : value.toString(16).padStart(Math.ceil(width / 4), '0');
  const segments = ['M8 4H24', 'M27 7V23', 'M27 29V45', 'M8 48H24', 'M5 29V45', 'M5 7V23', 'M8 26H24'];
  return <span className="nf-seven" aria-label={value === undefined ? '—' : `0x${digits.toUpperCase()}`}>
    {[...digits].map((digit, index) => <svg key={index} viewBox="0 0 33 52" aria-hidden="true">{segments.map((path, segment) => <path key={segment} d={path} stroke={(SEVEN_SEGMENT[parseInt(digit, 16)] ?? 0) & (1 << segment) ? '#efb34b' : '#29313b'} strokeWidth={4} strokeLinecap="round" />)}</svg>)}
  </span>;
}

function LogicSymbol({ type }: { type: Component['type'] }) {
  if (type === 'CLOCK') return <Clock3 size={22} />;
  if (type === 'RAM' || type === 'ROM') return <Database size={22} />;
  if (type === 'INPUT') return <ToggleLeft size={22} />;
  if (type === 'OUTPUT') return <Radio size={22} />;
  if (['DFF', 'REGISTER', 'COUNTER'].includes(type)) return <Waves size={22} />;
  if (type === 'CHIP') return <Cpu size={22} />;
  if (['NOT', 'BUFFER', 'AND', 'NAND', 'OR', 'NOR', 'XOR', 'XNOR'].includes(type)) {
    const inverted = ['NOT', 'NAND', 'NOR', 'XNOR'].includes(type);
    const isOr = ['OR', 'NOR', 'XOR', 'XNOR'].includes(type);
    return <svg viewBox="0 0 52 34" className="nf-logic-symbol" aria-hidden="true">
      {['NOT', 'BUFFER'].includes(type) ? <path d="M8 4L37 17L8 30Z" /> : isOr ? <path d="M7 4Q26 2 39 17Q26 32 7 30Q19 17 7 4Z" /> : <path d="M9 4H22A13 13 0 0 1 22 30H9Z" />}
      {['XOR', 'XNOR'].includes(type) && <path d="M2 4Q14 17 2 30" />}
      {inverted && <circle cx="43" cy="17" r="3" />}
    </svg>;
  }
  const marks: Partial<Record<Component['type'], string>> = { ADDER: '+', HALF_ADDER: '+', FULL_ADDER: '+', SUBTRACTOR: '−', COMPARATOR: '≷', MUX: '2:1', DEMUX: '1:2', DECODER: 'DEC', SPLIT: '↗', JOIN: '↘', CONST: '01' };
  return <span className="nf-node-symbol-text">{marks[type] ?? type}</span>;
}

export function nodeHeight(spec: ComponentSpec, component: Component): number {
  const pinHeight = Math.max(spec.inputs.length, spec.outputs.length, 1) * 23;
  const displayHeight = component.type === 'INPUT' || component.type === 'OUTPUT' ? 49 : 4;
  return 46 + pinHeight + displayHeight;
}

export const CircuitNode = memo(function CircuitNode({ id, data, selected }: NodeProps<CircuitFlowNode>) {
  const { component, spec, values, language, invalid, invalidPins, canSimulate, readOnly, onInput } = data;
  const t = editorText(language);
  const width = component.config.width ?? 1;
  const widthLabel = component.type === 'CHIP' ? [...new Set([...spec.inputs, ...spec.outputs].map(pin => pin.width))].sort((a, b) => a - b).join('/') : String(width);
  const title = component.label || (language === 'tr' ? translatedComponentLabels[component.type] : undefined) || spec.label;
  const value = component.type === 'OUTPUT' ? values.in : values.out;
  const outputDisplay = component.config.display ?? 'led';
  const inputButton = component.config.display === 'button';
  const height = nodeHeight(spec, component);
  const active = Object.values(values).some(current => current !== undefined && current !== 0);

  return <div className={`nf-circuit-node${selected ? ' is-selected' : ''}${invalid ? ' is-invalid' : ''}${active ? ' has-signal' : ''} nf-node-${component.type.toLowerCase()}`} style={{ height }} data-component-id={id} data-component-type={component.type}>
    <div className="nf-node-heading"><span className="nf-node-kind">{component.type === 'CHIP' ? 'CHIP' : component.type.replaceAll('_', ' ')}</span><span className="nf-node-bits">{widthLabel}b</span></div>
    <div className="nf-node-title" title={title}>{title}</div>
    <div className="nf-node-center"><LogicSymbol type={component.type} /></div>
    {spec.inputs.map((pin, index) => <div key={pin.name} className={`nf-pin nf-pin-input${invalidPins.includes(pin.name) ? ' is-invalid' : ''}`} style={{ top: 47 + index * 23 }}>
      <Handle type="target" position={Position.Left} id={pin.name} isConnectable={!readOnly} data-testid={`pin-${id}-${pin.name}-in`} aria-label={`${title} ${pin.name} ${pin.width}-bit input`} title={`${pin.name} · ${pin.width}b${pin.optional ? ` (${t.optional})` : ''}`} />
      <span className="nf-pin-name">{pin.name}</span><span className={`nf-pin-value${values[pin.name] ? ' is-high' : ''}`}>{formatSignal(values[pin.name], pin.width, pin.width === 1 ? 'decimal' : 'hex')}</span>
    </div>)}
    {spec.outputs.map((pin, index) => <div key={pin.name} className="nf-pin nf-pin-output" style={{ top: 47 + index * 23 }}>
      <span className={`nf-pin-value${values[pin.name] ? ' is-high' : ''}`}>{formatSignal(values[pin.name], pin.width, pin.width === 1 ? 'decimal' : 'hex')}</span><span className="nf-pin-name">{pin.name}</span>
      <Handle type="source" position={Position.Right} id={pin.name} isConnectable={!readOnly} data-testid={`pin-${id}-${pin.name}-out`} aria-label={`${title} ${pin.name} ${pin.width}-bit output`} title={`${pin.name} · ${pin.width}b`} />
    </div>)}
    {component.type === 'INPUT' && <div className="nf-node-control nodrag nopan">
      {width === 1 ? <button className={`nf-input-toggle${value ? ' is-on' : ''}${inputButton ? ' is-momentary' : ''}`} aria-label={`${t.toggle} ${title}`} aria-pressed={Boolean(value)} disabled={!canSimulate}
        onClick={inputButton ? undefined : event => { event.stopPropagation(); onInput(id, value ? 0 : 1); }}
        onPointerDown={inputButton ? event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onInput(id, 1); } : undefined}
        onPointerUp={inputButton ? event => { event.stopPropagation(); onInput(id, 0); } : undefined}
        onPointerCancel={inputButton ? () => onInput(id, 0) : undefined}
        onKeyDown={inputButton ? event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onInput(id, 1); } } : undefined}
        onKeyUp={inputButton ? event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); onInput(id, 0); } } : undefined}>
        <span className="nf-toggle-track"><span /></span><strong>{value === undefined ? '—' : value ? '1' : '0'}</strong><small>{inputButton ? t.button : value ? t.high : t.low}</small>
      </button> : <label className="nf-bus-input"><span>{t.value}</span><input aria-label={`${t.inputValue} ${title}`} type="number" min={0} max={2 ** width - 1} value={value ?? component.config.value ?? 0} disabled={!canSimulate} onChange={event => { const input = Number(event.target.value); if (Number.isInteger(input) && input >= 0 && input < 2 ** width) onInput(id, input); }} /><span>{formatSignal(value, width, 'hex')}</span></label>}
    </div>}
    {component.type === 'OUTPUT' && <div className="nf-node-control nf-output-display" data-testid={`output-${id}`} data-value={value ?? 'unavailable'}>
      {outputDisplay === 'seven' ? <SevenSegment value={value} width={width} /> : outputDisplay === 'led' && width === 1 ? <><span className={`nf-led${value ? ' is-on' : ''}`} /><strong>{value === undefined ? '—' : value ? '1' : '0'}</strong><small>{value === undefined ? t.unavailable : value ? t.high : t.low}</small></> : <span className={`nf-display-value${outputDisplay === 'binary' ? ' is-binary' : ''}`}>{formatSignal(value, width, outputDisplay === 'binary' ? 'binary' : 'hex')}</span>}
    </div>}
  </div>;
});
