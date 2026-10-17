import { useMemo, useState } from 'react';
import { ChevronDown, Cpu, GripVertical, Plus, Search, X } from 'lucide-react';
import { COMPONENT_CATALOG } from '../core';
import type { ChipDefinition, ComponentConfig, ComponentType } from '../core/types';
import { editorText, translatedComponentDescriptions, translatedComponentLabels, type EditorLanguage } from './i18n';

export interface PaletteItem {
  key: string;
  type: ComponentType;
  label: string;
  description: string;
  category: string;
  config?: ComponentConfig;
}

/** Only the small, typed set of palette configuration fields crosses a drag boundary. */
export function parsePaletteDrag(data: string, chips: ChipDefinition[]): PaletteItem | null {
  if (data.length > 2048) return null;
  try {
    const item = JSON.parse(data) as Partial<PaletteItem>;
    if (typeof item.label !== 'string' || item.label.length > 80 || typeof item.key !== 'string' || typeof item.type !== 'string') return null;
    if (!COMPONENT_CATALOG.some(entry => entry.type === item.type) && item.type !== 'CHIP') return null;
    const config: ComponentConfig = {};
    if (item.config) {
      if (typeof item.config !== 'object' || Array.isArray(item.config)) return null;
      const width = item.config.width;
      if (width !== undefined && (!Number.isInteger(width) || width < 1 || width > 16)) return null;
      if (width !== undefined) config.width = width;
      if (item.config.display && ['switch', 'button', 'led', 'binary', 'hex', 'seven'].includes(item.config.display)) config.display = item.config.display;
      if (item.type === 'CHIP') {
        if (!chips.some(chip => chip.id === item.config?.chipId)) return null;
        config.chipId = item.config.chipId;
      }
    } else if (item.type === 'CHIP') return null;
    return { key: item.key, type: item.type, label: item.label, description: typeof item.description === 'string' ? item.description.slice(0, 500) : '', category: typeof item.category === 'string' ? item.category : '', config };
  } catch { return null; }
}

interface Props {
  chips: ChipDefinition[];
  language: EditorLanguage;
  onPlace(item: PaletteItem): void;
  onClose(): void;
}

export function Palette({ chips, language, onPlace, onClose }: Props) {
  const t = editorText(language);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const categoryNames: Record<string, string> = { 'Inputs & outputs': t.inputs, 'Basic gates': t.gates, Arithmetic: t.arithmetic, Routing: t.routing, Sequential: t.sequential, Memory: t.memory, Custom: t.custom };
  const items = useMemo<PaletteItem[]>(() => {
    const catalog = COMPONENT_CATALOG.filter(entry => !['INPUT', 'OUTPUT', 'CLOCK', 'CONST'].includes(entry.type)).map(entry => ({
      ...entry, key: entry.type,
      label: language === 'tr' ? translatedComponentLabels[entry.type] ?? entry.label : entry.label,
      description: language === 'tr' ? translatedComponentDescriptions[entry.type] ?? entry.description : entry.description,
      config: entry.type === 'ADDER' || entry.type === 'SUBTRACTOR' || entry.type === 'REGISTER' || entry.type === 'COUNTER' || entry.type === 'RAM' || entry.type === 'ROM' ? { width: 8 } : entry.type === 'SPLIT' || entry.type === 'JOIN' ? { width: 4 } : undefined,
    }));
    const basic: PaletteItem[] = [
      { key: 'switch', type: 'INPUT', label: t.switch, category: 'Inputs & outputs', config: { display: 'switch' }, description: language === 'tr' ? translatedComponentDescriptions.INPUT! : 'Toggle a real single-bit input signal.' },
      { key: 'button', type: 'INPUT', label: t.button, category: 'Inputs & outputs', config: { display: 'button' }, description: language === 'tr' ? 'Basılı tutulurken 1, bırakıldığında 0 üretir.' : 'Momentary input: high while pressed, low when released.' },
      { key: 'clock', type: 'CLOCK', label: t.clock, category: 'Inputs & outputs', description: language === 'tr' ? translatedComponentDescriptions.CLOCK! : 'Clock pulses advance every state element atomically.' },
      { key: 'constant', type: 'CONST', label: t.constant, category: 'Inputs & outputs', description: language === 'tr' ? translatedComponentDescriptions.CONST! : 'A constant, explicitly sized signal.' },
      { key: 'led', type: 'OUTPUT', label: t.led, category: 'Inputs & outputs', config: { display: 'led' }, description: language === 'tr' ? 'Tek bitlik sinyali ışık ve 0/1 değeriyle gösterir.' : 'Observe a single bit with a light and a numeric state.' },
      { key: 'binary', type: 'OUTPUT', label: t.binary, category: 'Inputs & outputs', config: { display: 'binary', width: 8 }, description: language === 'tr' ? 'Çok bitli sinyali ikili sayı olarak gösterir.' : 'Display each bit of a bus.' },
      { key: 'hex', type: 'OUTPUT', label: t.hex, category: 'Inputs & outputs', config: { display: 'hex', width: 8 }, description: language === 'tr' ? 'Çok bitli sinyali onaltılı sayı olarak gösterir.' : 'Display a bus in hexadecimal.' },
      { key: 'seven', type: 'OUTPUT', label: t.seven, category: 'Inputs & outputs', config: { display: 'seven', width: 4 }, description: language === 'tr' ? 'Sinyalin onaltılı basamaklarını 7 segmentli göstergeyle gösterir.' : 'Render actual hexadecimal digits with seven-segment indicators.' },
    ];
    return [...basic, ...catalog, ...chips.map(chip => ({ key: chip.id, type: 'CHIP' as const, label: chip.name, description: chip.description, category: 'Custom', config: { chipId: chip.id } }))];
  }, [chips, language, t]);
  const filtered = items.filter(item => `${item.label} ${item.type} ${item.description} ${categoryNames[item.category] ?? ''}`.toLocaleLowerCase(language).includes(search.toLocaleLowerCase(language)));
  const categories = [...new Set([...items.map(item => item.category), 'Custom'])];

  return <aside className="nf-palette" aria-label={t.palette}>
    <div className="nf-panel-heading"><h2>{t.palette}</h2><button className="nf-icon-button nf-panel-close" aria-label={t.close} onClick={onClose}><X size={16} /></button><kbd>+</kbd></div>
    <label className="nf-palette-search"><Search size={15} /><input type="search" placeholder={t.search} aria-label={t.searchLabel} value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div className="nf-palette-list">
      {categories.map(category => {
        const members = filtered.filter(item => item.category === category);
        if (!members.length && (category !== 'Custom' || search)) return null;
        const open = Boolean(search) || !collapsed.has(category);
        return <section className="nf-palette-group" key={category}>
          <button className="nf-palette-category" aria-expanded={open} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(category)) next.delete(category); else next.add(category); return next; })}><ChevronDown size={12} className={open ? '' : 'is-collapsed'} /><span>{categoryNames[category] ?? category}</span><small>{members.length}</small></button>
          {open && <div className="nf-palette-members">{members.map(item => <button className="nf-palette-item" key={item.key} draggable onDragStart={event => { event.dataTransfer.setData('application/nandforge-component', JSON.stringify(item)); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => onPlace(item)} title={item.description} data-testid={`palette-${item.key}`}>
            <span className={`nf-palette-symbol nf-symbol-${item.type.toLowerCase()}`}>{item.type === 'CHIP' ? <Cpu size={14} /> : item.type === 'INPUT' ? '↗' : item.type === 'OUTPUT' ? '◉' : item.type === 'CLOCK' ? '╱' : item.type === 'CONST' ? '01' : item.type === 'HALF_ADDER' || item.type === 'FULL_ADDER' || item.type === 'ADDER' ? '+' : item.type === 'SUBTRACTOR' ? '−' : item.type.slice(0, 3)}</span>
            <span>{item.label}</span><GripVertical size={12} className="nf-palette-grip" /><Plus size={12} className="nf-palette-plus" />
          </button>)}{!members.length && <p className="nf-palette-empty">{t.noChips}</p>}</div>}
        </section>;
      })}
      {!filtered.length && search && <p className="nf-palette-empty">{t.noResults}</p>}
    </div>
    <div className="nf-palette-foot"><Cpu size={14} /><span>NAND → CPU</span><span className="nf-live-dot" /></div>
  </aside>;
}
