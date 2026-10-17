import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Cpu, Info, Play, Table2, X } from 'lucide-react';
import { truthTable } from '../core';
import type { ChipDefinition, Circuit, Diagnostic } from '../core/types';
import { diagnosticText, editorText, type EditorLanguage } from './i18n';
import { createChipFromCircuit, formatSignal } from './model';

export function DiagnosticsPanel({ diagnostics, language, onSelect }: { diagnostics: Diagnostic[]; language: EditorLanguage; onSelect(nodeId: string): void }) {
  const t = editorText(language);
  return <div className="nf-diagnostics" aria-label={t.diagnostics}>
    {!diagnostics.length ? <div className="nf-dock-empty nf-success"><CheckCircle2 size={24} /><p>{t.noErrors}</p></div> : diagnostics.map((diagnostic, index) => <button className={`nf-diagnostic ${diagnostic.severity}`} key={`${diagnostic.code}:${diagnostic.nodeId ?? ''}:${index}`} onClick={() => diagnostic.nodeId && onSelect(diagnostic.nodeId)} disabled={!diagnostic.nodeId}>
      {diagnostic.severity === 'error' ? <AlertCircle size={15} /> : <Info size={15} />}
      <span><strong>{diagnosticText(diagnostic.code, diagnostic.message, language)}</strong><small>{diagnostic.code}{diagnostic.nodeId ? ` · ${diagnostic.nodeId}` : ''}{diagnostic.pin ? `.${diagnostic.pin}` : ''}</small></span>
    </button>)}
  </div>;
}

export function TruthTablePanel({ circuit, chips, language }: { circuit: Circuit; chips: ChipDefinition[]; language: EditorLanguage }) {
  const t = editorText(language);
  const [result, setResult] = useState<ReturnType<typeof truthTable> | null>(null);
  const [evaluatedDefinition, setEvaluatedDefinition] = useState('');
  const definition = JSON.stringify({ circuit, chips });
  const currentResult = definition === evaluatedDefinition ? result : null;
  return <div className="nf-truth-panel">
    <div className="nf-truth-heading"><div><strong>{t.truthTable}</strong><p>{t.truthHint}</p></div><button className="nf-button nf-button-primary" onClick={() => { setResult(truthTable(circuit, chips, 8)); setEvaluatedDefinition(definition); }}><Play size={13} />{t.generateTable}</button></div>
    {!currentResult ? <div className="nf-dock-empty"><Table2 size={22} /><p>{t.tableEmpty}</p></div> : currentResult.diagnostics.some(item => item.severity === 'error') ? <DiagnosticsPanel diagnostics={currentResult.diagnostics} language={language} onSelect={() => undefined} /> : <>
      <div className="nf-truth-scroll"><table className="nf-truth-table"><thead><tr><th>#</th>{currentResult.inputs.map(input => <th key={input.nodeId}>{input.name}<small>{input.width}b ↓</small></th>)}{currentResult.outputs.map(output => <th className="nf-output-column" key={output.nodeId}>{output.name}<small>{output.width}b ↑</small></th>)}</tr></thead><tbody>{currentResult.rows.map((row, index) => <tr key={index}><td>{index}</td>{currentResult.inputs.map(input => <td key={input.nodeId}>{formatSignal(row.inputs[input.nodeId], input.width, input.width === 1 ? 'decimal' : 'hex')}</td>)}{currentResult.outputs.map(output => <td className="nf-output-column" key={output.nodeId} data-testid={`truth-${index}-${output.nodeId}`}>{formatSignal(row.outputs[output.nodeId], output.width, output.width === 1 ? 'decimal' : 'hex')}</td>)}</tr>)}</tbody></table></div>
      <p className="nf-truth-result"><CheckCircle2 size={13} />{currentResult.rows.length} {t.tableRows}</p>
    </>}
  </div>;
}

export function ChipDialog({ circuit, chips, selection, language, onSave, onClose }: { circuit: Circuit; chips: ChipDefinition[]; selection: Set<string>; language: EditorLanguage; onSave(chip: ChipDefinition): void; onClose(): void }) {
  const t = editorText(language);
  const [name, setName] = useState(circuit.name === 'Untitled circuit' ? '' : `${circuit.name} chip`);
  const [description, setDescription] = useState('');
  const [useSelection, setUseSelection] = useState(selection.size > 0);
  const [error, setError] = useState('');
  const modal = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <div className="nf-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={modal} className="nf-modal" role="dialog" aria-modal="true" aria-labelledby="nf-chip-dialog-heading" onKeyDown={event => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const focusable = modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]');
        const first = focusable?.[0];
        const last = focusable?.[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="nf-modal-heading"><Cpu size={22} /><h2 id="nf-chip-dialog-heading">{t.chipDialogTitle}</h2><button className="nf-icon-button" aria-label={t.close} onClick={onClose}><X size={18} /></button></div>
      <p>{t.chipDialogHint}</p>
      <form onSubmit={event => {
        event.preventDefault();
        if (!name.trim()) return;
        try { const chip = createChipFromCircuit(circuit, useSelection ? selection : null, name, description, chips); onSave(chip); onClose(); } catch (exception) { const code = exception instanceof Error ? exception.message : 'chipInvalid'; setError(code === 'chipNeedsPorts' ? t.chipNeedsPorts : t.chipInvalid); }
      }}>
        <label className="nf-field">{t.chipName}<input autoFocus required maxLength={64} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="nf-field">{t.chipDescription}<textarea rows={3} maxLength={400} value={description} onChange={event => setDescription(event.target.value)} /></label>
        {selection.size > 0 && <label className="nf-checkbox-field"><input type="checkbox" checked={useSelection} onChange={event => setUseSelection(event.target.checked)} />{useSelection ? t.chipSelection : t.chipWhole}<span>{useSelection ? selection.size : circuit.components.length} {t.components}</span></label>}
        {error && <p className="nf-inline-error" role="alert"><AlertCircle size={15} />{error}</p>}
        <div className="nf-modal-actions"><button type="button" className="nf-button" onClick={onClose}>{t.cancel}</button><button type="submit" className="nf-button nf-button-primary" disabled={!name.trim()}><Cpu size={14} />{t.createChip}</button></div>
      </form>
    </section>
  </div>;
}
