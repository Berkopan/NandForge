import { useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ChevronRight, Cpu, Info, Settings2, Trash2, Unplug, X } from 'lucide-react';
import { getComponentSpec } from '../core';
import type { ChipDefinition, Circuit, Component, Connection, Endpoint } from '../core/types';
import { editorText, translatedComponentDescriptions, translatedComponentLabels, type EditorLanguage } from './i18n';
import { formatSignal, parseMemoryContents } from './model';
import { probeId, type SignalProbe } from './waveforms';

interface InspectorProps {
  component: Component | undefined;
  wire: Connection | undefined;
  circuit: Circuit;
  chips: ChipDefinition[];
  language: EditorLanguage;
  readOnly: boolean;
  simulationReadOnly?: boolean;
  canInspectLive: boolean;
  selectionCount: number;
  read(nodeId: string, pin: string): number | undefined;
  onUpdate(component: Component): void;
  onConnect(to: Endpoint, from: Endpoint | null): void;
  onInput(nodeId: string, value: number): void;
  onProbe(probe: SignalProbe): void;
  probes: SignalProbe[];
  onInspect(component: Component): void;
  onDelete(): void;
  onClose(): void;
}

const NO_INTERNALS = new Set(['NAND', 'INPUT', 'OUTPUT', 'CONST', 'CLOCK', 'DFF', 'RAM', 'ROM', 'SPLIT', 'JOIN']);
const FIXED_WIDTH = new Set(['CLOCK', 'HALF_ADDER', 'FULL_ADDER', 'CHIP']);

function MemoryEditor({ component, language, onUpdate }: { component: Component; language: EditorLanguage; onUpdate(component: Component): void }) {
  const t = editorText(language);
  const [contents, setContents] = useState(() => component.config.contents?.map(value => `0x${value.toString(16).toUpperCase()}`).join(' ') ?? '');
  const [invalid, setInvalid] = useState(false);
  return <div className="nf-memory-editor">
    <label>{t.memoryContents}<textarea aria-label={t.memoryContents} value={contents} rows={5} spellCheck={false} onChange={event => { setContents(event.target.value); setInvalid(false); }} /></label>
    <p>{t.memoryHint}</p>
    {invalid && <p className="nf-inline-error" role="alert">{t.memoryInvalid}</p>}
    <button className="nf-button nf-button-small" onClick={() => {
      const parsed = parseMemoryContents(contents, component.config.width ?? 1, component.config.addressWidth ?? 8);
      if (!parsed) { setInvalid(true); return; }
      onUpdate({ ...component, config: { ...component.config, contents: parsed } });
    }}><ArrowDownToLine size={13} />{t.applyMemory}</button>
  </div>;
}

export function Inspector({ component, wire, circuit, chips, language, readOnly, simulationReadOnly = false, canInspectLive, selectionCount, read, onUpdate, onConnect, onInput, onProbe, probes, onInspect, onDelete, onClose }: InspectorProps) {
  const t = editorText(language);
  const [format, setFormat] = useState<'hex' | 'binary' | 'decimal'>('hex');
  const spec = component ? getComponentSpec(component, chips) : undefined;
  const name = component ? component.label || (language === 'tr' ? translatedComponentLabels[component.type] : undefined) || spec?.label || component.type : undefined;
  const width = component?.config.width ?? 1;
  const canInspect = component && !NO_INTERNALS.has(component.type);
  const source = wire ? circuit.components.find(item => item.id === wire.from.node) : undefined;
  const sourcePin = source && wire ? getComponentSpec(source, chips).outputs.find(pin => pin.name === wire.from.pin) : undefined;
  const outputOptions = readOnly ? [] : circuit.components.flatMap(item => getComponentSpec(item, chips).outputs.map(pin => ({ nodeId: item.id, nodeLabel: item.label || getComponentSpec(item, chips).label, ...pin })));
  const description = component ? (language === 'tr' && component.type !== 'CHIP' ? translatedComponentDescriptions[component.type] : spec?.description) : '';

  const probe = (nodeId: string, pin: string, bits: number, label: string) => onProbe({ id: probeId(nodeId, pin), nodeId, pin, width: bits, name: label });

  return <aside className="nf-inspector" aria-label={t.inspector}>
    <div className="nf-panel-heading"><h2>{t.inspector}</h2><Settings2 size={14} /><button className="nf-icon-button nf-panel-close" aria-label={t.close} onClick={onClose}><X size={16} /></button></div>
    {!component && !wire ? <div className="nf-inspector-empty"><Cpu size={35} /><h3>{selectionCount > 1 ? `${selectionCount} ${t.selected}` : t.properties}</h3><p>{t.inspectHint}</p><div className="nf-inspector-tip"><Info size={15} /><span>{t.widthHint}</span></div><div className="nf-shortcuts"><strong>{t.keyboard}</strong><p>{t.shortcutsHint}</p></div></div> : component && spec ? <div className="nf-inspector-scroll">
      <div className="nf-inspector-identity"><span className="nf-component-tag">{component.type.replaceAll('_', ' ')}</span><h3>{name}</h3><p>{description}</p></div>
      {canInspect && <button className="nf-button nf-inspect-internals" disabled={!canInspectLive} title={canInspectLive ? t.showInternals : t.inspectNeedsSimulation} onClick={() => onInspect(component)}><Cpu size={15} /><span>{t.showInternals}</span><ChevronRight size={15} /></button>}
      <section className="nf-inspector-section"><h4>{t.properties}</h4>
        <label className="nf-field">{t.label}<input aria-label={t.label} value={component.label ?? ''} placeholder={spec.label} disabled={readOnly} maxLength={80} onChange={event => onUpdate({ ...component, label: event.target.value })} /></label>
        {!FIXED_WIDTH.has(component.type) && <label className="nf-field nf-field-inline">{t.width}<select aria-label={t.width} disabled={readOnly} value={width} onChange={event => {
          const nextWidth = Number(event.target.value);
          const mask = 2 ** nextWidth - 1;
          const config = { ...component.config, width: nextWidth, value: (component.config.value ?? 0) & mask, initial: (component.config.initial ?? 0) & mask };
          if (config.contents) config.contents = config.contents.map(value => value & mask);
          onUpdate({ ...component, config });
        }}>{Array.from({ length: component.type === 'DECODER' ? 8 : 16 }, (_, index) => <option value={index + 1} key={index}>{index + 1} bit</option>)}</select></label>}
        {(component.type === 'RAM' || component.type === 'ROM') && <label className="nf-field nf-field-inline">{t.addressWidth}<select aria-label={t.addressWidth} disabled={readOnly} value={component.config.addressWidth ?? 8} onChange={event => { const addressWidth = Number(event.target.value); onUpdate({ ...component, config: { ...component.config, addressWidth, contents: component.config.contents?.slice(0, 2 ** addressWidth) } }); }}>{Array.from({ length: 8 }, (_, index) => <option value={index + 1} key={index}>{index + 1} · {2 ** (index + 1)} {t.words}</option>)}</select></label>}
        {['CONST', 'INPUT', 'DFF', 'REGISTER', 'COUNTER'].includes(component.type) && <label className="nf-field nf-field-inline">{component.type === 'CONST' ? t.value : t.initial}<input type="number" aria-label={component.type === 'CONST' ? t.value : t.initial} min={0} max={2 ** width - 1} disabled={readOnly} value={component.type === 'CONST' || component.type === 'INPUT' ? component.config.value ?? 0 : component.config.initial ?? 0} onChange={event => { const value = Number(event.target.value); if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) return; onUpdate({ ...component, config: { ...component.config, [component.type === 'CONST' || component.type === 'INPUT' ? 'value' : 'initial']: value } }); }} /></label>}
        {(component.type === 'INPUT' || component.type === 'OUTPUT') && <label className="nf-field nf-field-inline">{t.format}<select aria-label={t.format} value={component.config.display ?? (component.type === 'INPUT' ? 'switch' : 'led')} disabled={readOnly} onChange={event => onUpdate({ ...component, config: { ...component.config, display: event.target.value as Component['config']['display'] } })}>
          {component.type === 'INPUT' ? <><option value="switch">{t.switch}</option><option value="button">{t.button}</option></> : <><option value="led">{t.led}</option><option value="binary">{t.binary}</option><option value="hex">{t.hex}</option><option value="seven">{t.seven}</option></>}
        </select></label>}
        {component.type === 'INPUT' && <label className="nf-field nf-field-inline">{t.inputValue}<input type="number" aria-label={t.inputValue} disabled={simulationReadOnly} min={0} max={2 ** width - 1} value={read(component.id, 'out') ?? component.config.value ?? 0} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value < 2 ** width) onInput(component.id, value); }} /></label>}
      </section>
      <section className="nf-inspector-section"><div className="nf-section-heading"><h4>{t.liveSignals}</h4><select aria-label={t.format} value={format} onChange={event => setFormat(event.target.value as typeof format)}><option value="hex">HEX</option><option value="decimal">DEC</option><option value="binary">BIN</option></select></div>
        {spec.inputs.length > 0 && <h5>{t.inputPins}</h5>}
        {spec.inputs.map(pin => {
          const connection = circuit.connections.find(item => item.to.node === component.id && item.to.pin === pin.name);
          const liveValue = read(component.id, pin.name);
          return <div className="nf-inspector-pin" key={pin.name}><div className="nf-pin-data"><span><i className={liveValue ? 'is-high' : ''} />{pin.name}<small>{pin.width}b{pin.optional ? ' *' : ''}</small></span><code>{formatSignal(liveValue, pin.width, pin.width === 1 ? 'decimal' : format)}</code></div>
            {!readOnly && <select aria-label={`${t.connect} ${name}.${pin.name}`} value={connection ? JSON.stringify(connection.from) : ''} onChange={event => onConnect({ node: component.id, pin: pin.name }, event.target.value ? JSON.parse(event.target.value) as Endpoint : null)}>
              <option value="">{t.disconnected}{pin.optional ? ` (${t.optional})` : ''}</option>
              {outputOptions.filter(output => output.width === pin.width).map(output => <option key={`${output.nodeId}:${output.name}`} value={JSON.stringify({ node: output.nodeId, pin: output.name })}>{output.nodeLabel}.{output.name} · {output.width}b</option>)}
            </select>}
          </div>;
        })}
        {spec.outputs.length > 0 && <h5>{t.outputPins}</h5>}
        {spec.outputs.map(pin => {
          const id = probeId(component.id, pin.name);
          const isProbed = probes.some(item => item.id === id);
          const value = read(component.id, pin.name);
          return <div className="nf-inspector-pin" key={pin.name}><div className="nf-pin-data"><span><i className={value ? 'is-high' : ''} />{pin.name}<small>{pin.width}b</small></span><code>{formatSignal(value, pin.width, pin.width === 1 ? 'decimal' : format)}</code></div><button className={`nf-probe-button${isProbed ? ' is-active' : ''}`} aria-pressed={isProbed} title={`${isProbed ? t.removeProbe : t.addProbe}: ${pin.name}`} onClick={() => probe(component.id, pin.name, pin.width, `${name}.${pin.name}`)}><Activity size={12} />{isProbed ? t.removeProbe : t.addProbe}</button></div>;
        })}
        {component.type === 'OUTPUT' && <button className="nf-button nf-button-small" onClick={() => probe(component.id, 'in', width, name ?? component.id)}><Activity size={13} />{probes.some(item => item.id === probeId(component.id, 'in')) ? t.removeProbe : t.addProbe}</button>}
      </section>
      {!readOnly && (component.type === 'RAM' || component.type === 'ROM') && <section className="nf-inspector-section"><MemoryEditor key={`${component.id}:${component.config.width}:${component.config.addressWidth}`} component={component} language={language} onUpdate={onUpdate} /></section>}
      {!readOnly && <section className="nf-inspector-section"><button className="nf-button nf-button-danger" onClick={onDelete}><Trash2 size={14} />{t.remove}</button></section>}
    </div> : wire ? <div className="nf-inspector-scroll"><div className="nf-inspector-identity"><span className="nf-component-tag">{t.wire}</span><h3>{source?.label || source?.type}.{wire.from.pin}</h3><p>{sourcePin?.width ?? '?'} bit</p></div>
      <div className="nf-wire-route"><span>{source?.label || wire.from.node}.{wire.from.pin}</span><ArrowRight size={16} /><span>{circuit.components.find(item => item.id === wire.to.node)?.label || wire.to.node}.{wire.to.pin}</span></div>
      <section className="nf-inspector-section"><h4>{t.value}</h4><dl className="nf-wire-values"><dt>HEX</dt><dd>{formatSignal(read(wire.from.node, wire.from.pin), sourcePin?.width ?? 1, 'hex')}</dd><dt>BIN</dt><dd>{formatSignal(read(wire.from.node, wire.from.pin), sourcePin?.width ?? 1, 'binary')}</dd><dt>DEC</dt><dd>{formatSignal(read(wire.from.node, wire.from.pin), sourcePin?.width ?? 1, 'decimal')}</dd></dl></section>
      <button className="nf-button" onClick={() => probe(wire.from.node, wire.from.pin, sourcePin?.width ?? 1, `${source?.label || source?.type}.${wire.from.pin}`)}><Activity size={14} />{probes.some(item => item.id === probeId(wire.from.node, wire.from.pin)) ? t.removeProbe : t.addProbe}</button>
      {!readOnly && <button className="nf-button nf-button-danger" onClick={onDelete}><Unplug size={14} />{t.remove}</button>}
    </div> : null}
  </aside>;
}
