import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, SelectionMode, useReactFlow, type Connection as FlowConnection, type EdgeChange, type NodeChange, type NodeTypes, type EdgeTypes } from '@xyflow/react';
import { Activity, AlertCircle, ArrowLeft, Check, ChevronRight, Copy, Cpu, Grid2X2, Layers, LayoutGrid, Maximize, MoreHorizontal, MousePointer2, PanelLeft, PanelRight, Pause, Play, Plus, Redo2, RotateCcw, SkipForward, Table2, Trash2, Undo2, X } from 'lucide-react';
import { createComponent, getChipForComponent, getComponentSpec, type Simulator } from '../core';
import type { ChipDefinition, Circuit, Component, Endpoint, Position } from '../core/types';
import { CircuitNode, nodeHeight, type CircuitFlowNode } from './CircuitNode';
import { SignalEdge, type CircuitFlowEdge } from './SignalEdge';
import { Palette, parsePaletteDrag, type PaletteItem } from './Palette';
import { Inspector } from './Inspector';
import { ChipDialog, DiagnosticsPanel, TruthTablePanel } from './EditorPanels';
import { WaveformPanel } from './WaveformPanel';
import { editorText, type EditorLanguage } from './i18n';
import { arrangeCircuit, connectionProblem, copySelection, deleteSelection, editorId, pasteFragment, replaceInputConnection, type CircuitFragment } from './model';
import { probeId, type SignalProbe } from './waveforms';
import { useCircuitRuntime } from './useCircuitRuntime';
import '@xyflow/react/dist/style.css';
import './editor.css';

export interface CircuitEditorProps {
  circuit: Circuit;
  chips: ChipDefinition[];
  onChange(circuit: Circuit): void;
  onChipsChange(chips: ChipDefinition[]): void;
  language: EditorLanguage;
  readOnly?: boolean;
  onNotify?(message: string): void;
  /** Supply an existing machine to inspect its actual live state without mutating it. */
  externalSimulator?: Simulator;
  externalRevision?: number;
  externalSignalPrefix?: string;
}

interface Inspection { circuit: Circuit; name: string; simulator: Simulator; signalPrefix: string }

interface WorkspaceProps extends CircuitEditorProps {
  onOpenInspection(inspection: Inspection): void;
}

const nodeTypes = { circuit: CircuitNode } satisfies NodeTypes;
const edgeTypes = { signal: SignalEdge } satisfies EdgeTypes;
const NOOP = () => undefined;
const MAX_UNDO = 80;

/** The navigation layers stay mounted, preserving parent clocked state and editor undo. */
function EditorNavigator(props: CircuitEditorProps) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const t = editorText(props.language);
  return <div className="nf-editor-root">
    {inspections.length > 0 && <div className="nf-editor-breadcrumb"><button onClick={() => setInspections([])}><ArrowLeft size={14} />{props.circuit.name}</button>{inspections.map((inspection, index) => <span key={inspection.circuit.id}><ChevronRight size={12} /><button onClick={() => setInspections(current => current.slice(0, index + 1))}>{inspection.name}</button></span>)}<small>{t.inspectMode}</small></div>}
    <div className="nf-editor-layer" hidden={inspections.length > 0}><ReactFlowProvider><CircuitWorkspace {...props} onOpenInspection={inspection => setInspections([inspection])} /></ReactFlowProvider></div>
    {inspections.map((inspection, index) => <div className="nf-editor-layer" key={inspection.circuit.id} hidden={index !== inspections.length - 1}>
      <div className="nf-inspection-notice"><Cpu size={14} /><span>{t.inspectReadOnly}</span><button onClick={() => setInspections(current => current.slice(0, -1))}>{t.returnToCircuit}</button></div>
      <ReactFlowProvider><CircuitWorkspace circuit={inspection.circuit} chips={props.chips} onChange={NOOP} onChipsChange={props.onChipsChange} language={props.language} readOnly externalSimulator={inspection.simulator} externalSignalPrefix={inspection.signalPrefix} externalRevision={props.externalRevision} onNotify={props.onNotify} onOpenInspection={nested => setInspections(current => [...current, nested])} /></ReactFlowProvider>
    </div>)}
  </div>;
}

export function CircuitEditor(props: CircuitEditorProps) {
  return <EditorNavigator key={props.circuit.id} {...props} />;
}

function CircuitWorkspace({ circuit, chips, onChange, onChipsChange, language, readOnly = false, onNotify, onOpenInspection, externalSimulator, externalRevision = 0, externalSignalPrefix = '' }: WorkspaceProps) {
  const t = editorText(language);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const flow = useReactFlow<CircuitFlowNode, CircuitFlowEdge>();
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [dragPositions, setDragPositions] = useState<Record<string, Position>>({});
  const [history, setHistory] = useState<{ past: Circuit[]; future: Circuit[] }>({ past: [], future: [] });
  const [clipboard, setClipboard] = useState<CircuitFragment | null>(null);
  const [pasteCount, setPasteCount] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(() => window.innerWidth >= 760 && !readOnly);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1150);
  const [snap, setSnap] = useState(true);
  const [minimap, setMinimap] = useState(false);
  const [dock, setDock] = useState<'waveform' | 'diagnostics' | 'truth' | null>(null);
  const [chipDialog, setChipDialog] = useState(false);
  const [storedProbes, setProbes] = useState<SignalProbe[]>([]);
  const probes = useMemo(() => storedProbes.flatMap(probe => {
    const component = circuit.components.find(item => item.id === probe.nodeId);
    if (!component) return [];
    const spec = getComponentSpec(component, chips);
    const pin = [...spec.inputs, ...spec.outputs].find(item => item.name === probe.pin);
    return pin ? [pin.width === probe.width ? probe : { ...probe, width: pin.width }] : [];
  }), [storedProbes, circuit.components, chips]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<number | null>(null);
  const connectProblemRef = useRef<string | null>(null);
  const notify = useCallback((message: string) => {
    setNotice(message);
    onNotify?.(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 4200);
  }, [onNotify]);
  const onRunLimit = useCallback(() => notify(t.runLimit), [notify, t.runLimit]);
  const runtime = useCircuitRuntime(circuit, chips, probes, onRunLimit, externalSimulator, externalSignalPrefix, externalRevision);
  const errors = runtime.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  const warnings = runtime.diagnostics.filter(diagnostic => diagnostic.severity === 'warning');
  const circuitRef = useRef(circuit);
  circuitRef.current = circuit;

  const commit = useCallback((next: Circuit) => {
    if (readOnly || next === circuitRef.current) return;
    const previousCircuit = circuitRef.current;
    setHistory(previous => ({ past: [...previous.past.slice(-(MAX_UNDO - 1)), previousCircuit], future: [] }));
    circuitRef.current = next;
    onChange(next);
  }, [readOnly, onChange]);

  const undo = useCallback(() => {
    if (readOnly || !history.past.length) return;
    const previous = history.past.at(-1)!;
    setHistory({ past: history.past.slice(0, -1), future: [circuit, ...history.future] });
    setDragPositions({});
    onChange(previous);
  }, [readOnly, history, circuit, onChange]);

  const redo = useCallback(() => {
    if (readOnly || !history.future.length) return;
    const next = history.future[0]!;
    setHistory({ past: [...history.past.slice(-(MAX_UNDO - 1)), circuit], future: history.future.slice(1) });
    setDragPositions({});
    onChange(next);
  }, [readOnly, history, circuit, onChange]);

  const removeSelection = useCallback(() => {
    if (readOnly || selectedNodes.size + selectedEdges.size === 0) return;
    commit(deleteSelection(circuit, selectedNodes, selectedEdges));
    setProbes(previous => previous.filter(probe => !selectedNodes.has(probe.nodeId)));
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setContextMenu(null);
  }, [readOnly, selectedNodes, selectedEdges, commit, circuit]);

  const copy = useCallback(() => {
    if (!selectedNodes.size) { notify(t.nothingSelected); return; }
    setClipboard(copySelection(circuit, selectedNodes));
    setPasteCount(0);
    notify(t.copied);
  }, [selectedNodes, notify, t.nothingSelected, t.copied, circuit]);

  const paste = useCallback(() => {
    if (readOnly) return;
    if (!clipboard?.components.length) { notify(t.nothingToPaste); return; }
    const result = pasteFragment(circuit, clipboard, { x: 40 * (pasteCount + 1), y: 40 * (pasteCount + 1) });
    commit(result.circuit);
    setSelectedNodes(result.ids);
    setSelectedEdges(new Set());
    setPasteCount(value => value + 1);
  }, [readOnly, clipboard, notify, t.nothingToPaste, circuit, pasteCount, commit]);

  const duplicate = useCallback(() => {
    if (readOnly || !selectedNodes.size) return;
    const result = pasteFragment(circuit, copySelection(circuit, selectedNodes));
    commit(result.circuit);
    setSelectedNodes(result.ids);
    setSelectedEdges(new Set());
  }, [readOnly, selectedNodes, circuit, commit]);

  const fit = useCallback(() => { void flow.fitView({ padding: 0.25, maxZoom: 1.25, duration: 240 }); }, [flow]);

  const addProbe = useCallback((probe: SignalProbe) => {
    const exists = probes.some(item => item.id === probe.id);
    const next = exists ? probes.filter(item => item.id !== probe.id) : [...probes, probe];
    setProbes(next);
    setDock('waveform');
    if (!exists) { runtime.capture('initial', next); notify(t.probeAdded); }
  }, [probes, runtime, notify, t.probeAdded]);

  const inspect = useCallback((component: Component) => {
    const definition = getChipForComponent(component, chips);
    if (!definition || !runtime.simulator) return;
    runtime.setRunning(false);
    const internal = structuredClone(definition.circuit);
    internal.id = editorId('inspection');
    for (const binding of definition.inputs) {
      const input = internal.components.find(item => item.id === binding.nodeId);
      if (input) input.config.value = runtime.read(component.id, binding.name) ?? input.config.value ?? 0;
    }
    const occupied = new Set(internal.components.map(item => `${item.position.x},${item.position.y}`));
    const arranged = occupied.size < internal.components.length / 2 ? arrangeCircuit(internal, chips) : internal;
    onOpenInspection({ circuit: arranged, name: definition.name, simulator: runtime.simulator, signalPrefix: `${externalSignalPrefix}${component.id}/` });
  }, [chips, runtime, onOpenInspection, externalSignalPrefix]);

  const place = useCallback((item: PaletteItem, position?: Position) => {
    if (readOnly) return;
    const bounds = canvas.current?.getBoundingClientRect();
    let point = position ?? flow.screenToFlowPosition({ x: (bounds?.left ?? 0) + (bounds?.width ?? 800) * 0.47, y: (bounds?.top ?? 0) + (bounds?.height ?? 500) * 0.43 });
    if (!position) {
      point = { x: point.x - 88, y: point.y - 45 };
      let attempt = 0;
      while (circuit.components.some(component => Math.abs(component.position.x - point.x) < 195 && Math.abs(component.position.y - point.y) < 115) && attempt < 80) {
        point = { x: point.x + (attempt % 4 === 3 ? -660 : 220), y: point.y + (attempt % 4 === 3 ? 160 : 0) };
        attempt += 1;
      }
    }
    if (snap) point = { x: Math.round(point.x / 20) * 20, y: Math.round(point.y / 20) * 20 };
    const component = createComponent(item.type, editorId('node'), point, item.config);
    component.label = item.type === 'INPUT' || item.type === 'OUTPUT' ? `${item.label} ${circuit.components.filter(current => current.type === item.type).length + 1}` : item.label;
    commit({ ...circuit, components: [...circuit.components, component] });
    setSelectedNodes(new Set([component.id]));
    setSelectedEdges(new Set());
    setInspectorOpen(true);
    if (window.innerWidth < 760) setPaletteOpen(false);
    root.current?.focus({ preventScroll: true });
  }, [readOnly, flow, circuit, snap, commit]);

  const onConnect = useCallback((connection: FlowConnection) => {
    if (readOnly || !connection.source || !connection.target) return;
    const from = { node: connection.source, pin: connection.sourceHandle ?? 'out' };
    const to = { node: connection.target, pin: connection.targetHandle ?? 'in' };
    const problem = connectionProblem(circuit, from, to, chips);
    if (problem) { notify(`${t.invalidWire}: ${t[problem]}`); return; }
    commit({ ...circuit, connections: [...circuit.connections, { id: editorId('wire'), from, to }] });
  }, [readOnly, circuit, chips, notify, t, commit]);

  const connectInput = useCallback((to: Endpoint, from: Endpoint | null) => {
    try { commit(replaceInputConnection(circuit, to, from, chips)); } catch (error) { const problem = error instanceof Error ? error.message : 'invalidPin'; notify(`${t.invalidWire}: ${problem in t ? t[problem as keyof typeof t] : problem}`); }
  }, [commit, circuit, chips, notify, t]);

  const onNodesChange = useCallback((changes: NodeChange<CircuitFlowNode>[]) => {
    const selections = changes.filter(change => change.type === 'select');
    if (selections.length) setSelectedNodes(previous => { const next = new Set(previous); for (const change of selections) { if (change.selected) next.add(change.id); else next.delete(change.id); } return next; });
    if (!readOnly) {
      const positions = changes.filter(change => change.type === 'position');
      if (positions.length) setDragPositions(previous => { const next = { ...previous }; for (const change of positions) if (change.position) next[change.id] = change.position; return next; });
    }
  }, [readOnly]);

  const onEdgesChange = useCallback((changes: EdgeChange<CircuitFlowEdge>[]) => {
    const selections = changes.filter(change => change.type === 'select');
    if (selections.length) setSelectedEdges(previous => { const next = new Set(previous); for (const change of selections) { if (change.selected) next.add(change.id); else next.delete(change.id); } return next; });
  }, []);

  const nodes = useMemo<CircuitFlowNode[]>(() => circuit.components.map(component => {
    const spec = getComponentSpec(component, chips);
    const relevantErrors = runtime.diagnostics.filter(diagnostic => diagnostic.nodeId === component.id && diagnostic.severity === 'error');
    return {
      id: component.id, type: 'circuit', position: dragPositions[component.id] ?? component.position, selected: selectedNodes.has(component.id),
      width: 184, height: nodeHeight(spec, component), draggable: !readOnly,
      data: { component, spec, values: Object.fromEntries([...spec.inputs, ...spec.outputs].map(pin => [pin.name, runtime.read(component.id, pin.name)])), language, invalid: relevantErrors.length > 0, invalidPins: relevantErrors.flatMap(error => error.pin ? [error.pin] : []), canSimulate: Boolean(runtime.simulator) && !externalSimulator, readOnly, onInput: runtime.setInput },
      ariaLabel: `${component.label || spec.label}, ${component.type}`,
    };
  }), [circuit.components, chips, dragPositions, selectedNodes, readOnly, runtime.diagnostics, runtime.read, runtime.simulator, runtime.setInput, runtime.revision, language, externalSimulator, externalRevision]);

  const edges = useMemo<CircuitFlowEdge[]>(() => circuit.connections.map(wire => {
    const source = circuit.components.find(component => component.id === wire.from.node);
    const width = source ? getComponentSpec(source, chips).outputs.find(pin => pin.name === wire.from.pin)?.width ?? 1 : 1;
    return { id: wire.id, type: 'signal', source: wire.from.node, target: wire.to.node, sourceHandle: wire.from.pin, targetHandle: wire.to.pin, selected: selectedEdges.has(wire.id), data: { value: runtime.read(wire.from.node, wire.from.pin), width, invalid: runtime.diagnostics.some(diagnostic => diagnostic.connectionId === wire.id && diagnostic.severity === 'error'), probed: probes.some(probe => probe.id === probeId(wire.from.node, wire.from.pin)) } };
  }), [circuit, chips, selectedEdges, runtime.read, runtime.diagnostics, runtime.revision, probes, externalRevision]);

  const openContext = (clientX: number, clientY: number) => {
    const bounds = root.current?.getBoundingClientRect();
    setContextMenu({ x: Math.max(4, Math.min(clientX - (bounds?.left ?? 0), (bounds?.width ?? 600) - 210)), y: Math.max(4, Math.min(clientY - (bounds?.top ?? 0), (bounds?.height ?? 500) - 280)) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable)) return;
    if (event.target instanceof HTMLElement && event.target.closest('.nf-wave-scroll') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (!command && (event.key === ' ' || event.key === 'Enter') && event.target instanceof HTMLElement && event.target.closest('button')) return;
    if (command && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    else if (command && key === 'y') { event.preventDefault(); redo(); }
    else if (command && key === 'c') { event.preventDefault(); copy(); }
    else if (command && key === 'v') { event.preventDefault(); paste(); }
    else if (command && key === 'd') { event.preventDefault(); duplicate(); }
    else if (command && key === 'a') { event.preventDefault(); setSelectedNodes(new Set(circuit.components.map(component => component.id))); setSelectedEdges(new Set(circuit.connections.map(wire => wire.id))); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelection(); }
    else if (event.key === ' ' && !externalSimulator) { event.preventDefault(); if (runtime.simulator) runtime.setRunning(!runtime.running); }
    else if (key === 'f' && !command) { event.preventDefault(); fit(); }
    else if (event.key === 'Escape') { setContextMenu(null); setSelectedNodes(new Set()); setSelectedEdges(new Set()); }
    else if (!readOnly && !command && selectedNodes.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const amount = event.altKey ? 1 : snap ? 20 : 10;
      const delta = { x: event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, y: event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0 };
      commit({ ...circuit, components: circuit.components.map(component => selectedNodes.has(component.id) ? { ...component, position: { x: component.position.x + delta.x, y: component.position.y + delta.y } } : component) });
    }
  };

  const selectedComponent = selectedNodes.size === 1 ? circuit.components.find(component => selectedNodes.has(component.id)) : undefined;
  const selectedWire = selectedEdges.size === 1 && !selectedComponent ? circuit.connections.find(wire => selectedEdges.has(wire.id)) : undefined;
  const toggleDock = (next: typeof dock) => setDock(previous => previous === next ? null : next);
  const totalSelected = selectedNodes.size + selectedEdges.size;

  return <div className="nf-editor" ref={root} tabIndex={0} onKeyDownCapture={onKeyDown} aria-label={language === 'tr' ? 'Devre düzenleyici' : 'Circuit editor'}>
    <div className="nf-editor-toolbar">
      {!readOnly && <button className={`nf-icon-button${paletteOpen ? ' is-active' : ''}`} title={t.palette} aria-label={t.palette} aria-pressed={paletteOpen} onClick={() => setPaletteOpen(value => !value)}><PanelLeft size={17} /></button>}
      {!externalSimulator && <div className="nf-run-controls"><button className={`nf-run-button${runtime.running ? ' is-running' : ''}`} onClick={() => runtime.setRunning(!runtime.running)} disabled={!runtime.simulator} title={`${runtime.running ? t.pause : t.run} · Space`}><span>{runtime.running ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}</span>{runtime.running ? t.pause : t.run}</button><button className="nf-icon-button" aria-label={t.step} title={t.step} disabled={!runtime.simulator || runtime.running} onClick={runtime.step}><SkipForward size={16} /></button><button className="nf-icon-button" aria-label={t.reset} title={t.reset} disabled={!runtime.simulator} onClick={() => { runtime.reset(); notify(t.simulationReset); }}><RotateCcw size={15} /></button></div>}
      {!externalSimulator && <select className="nf-speed-select" aria-label={t.speed} value={runtime.speed} onChange={event => runtime.setSpeed(Number(event.target.value))}>{[1, 2, 5, 10, 20, 60].map(speed => <option key={speed} value={speed}>{speed} Hz</option>)}</select>}
      <span className="nf-cycle-count">{t.cycle}<strong>{runtime.simulator?.cycle ?? 0}</strong></span>
      <span className="nf-toolbar-divider" />
      {!readOnly && <><button className="nf-icon-button" aria-label={t.undo} title={`${t.undo} · ⌘Z`} disabled={!history.past.length} onClick={undo}><Undo2 size={16} /></button><button className="nf-icon-button" aria-label={t.redo} title={`${t.redo} · ⌘⇧Z`} disabled={!history.future.length} onClick={redo}><Redo2 size={16} /></button></>}
      <div className="nf-toolbar-spacer" />
      <button className={`nf-tool-button${dock === 'truth' ? ' is-active' : ''}`} onClick={() => toggleDock('truth')}><Table2 size={15} /><span>{t.truthTable}</span></button>
      {!readOnly && <button className="nf-tool-button" disabled={!circuit.components.length} onClick={() => setChipDialog(true)}><Cpu size={15} /><span>{t.saveChip}</span></button>}
      <button className={`nf-icon-button${inspectorOpen ? ' is-active' : ''}`} title={t.inspector} aria-label={t.inspector} aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}><PanelRight size={17} /></button>
      <button className="nf-icon-button" title={t.keyboard} aria-label={t.keyboard} onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); openContext(bounds.left - 175, bounds.bottom); }}><MoreHorizontal size={17} /></button>
    </div>
    <div className="nf-editor-body">
      {paletteOpen && !readOnly && <Palette chips={chips} language={language} onPlace={place} onClose={() => setPaletteOpen(false)} />}
      <div className="nf-editor-center"><div className="nf-canvas" ref={canvas} onDragOver={event => { if (readOnly) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={event => {
        if (readOnly) return;
        event.preventDefault();
        const data = event.dataTransfer.getData('application/nandforge-component');
        if (!data) return;
        const item = parsePaletteDrag(data, chips);
        if (item) place(item, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      }}>
        <ReactFlow<CircuitFlowNode, CircuitFlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeDragStop={(_, __, moved) => { if (readOnly) return; const positions = new Map(moved.map(node => [node.id, node.position])); commit({ ...circuit, components: circuit.components.map(component => positions.has(component.id) ? { ...component, position: positions.get(component.id)! } : component) }); setDragPositions({}); }}
          onNodeClick={() => { setContextMenu(null); if (window.innerWidth >= 760) setInspectorOpen(true); }}
          onNodeDoubleClick={(_, node) => inspect(node.data.component)}
          onEdgeClick={() => { setContextMenu(null); setInspectorOpen(true); }}
          onEdgeDoubleClick={(_, edge) => { const component = circuit.components.find(item => item.id === edge.source); const pin = component && getComponentSpec(component, chips).outputs.find(item => item.name === edge.sourceHandle); if (component && pin) addProbe({ id: probeId(component.id, pin.name), nodeId: component.id, pin: pin.name, width: pin.width, name: `${component.label || component.type}.${pin.name}` }); }}
          onNodeContextMenu={(event, node) => { event.preventDefault(); if (!selectedNodes.has(node.id)) { setSelectedNodes(new Set([node.id])); setSelectedEdges(new Set()); } openContext(event.clientX, event.clientY); }}
          onEdgeContextMenu={(event, edge) => { event.preventDefault(); setSelectedEdges(new Set([edge.id])); setSelectedNodes(new Set()); openContext(event.clientX, event.clientY); }}
          onPaneContextMenu={event => { event.preventDefault(); if ('clientX' in event && typeof event.clientX === 'number' && 'clientY' in event && typeof event.clientY === 'number') openContext(event.clientX, event.clientY); }}
          onPaneClick={() => setContextMenu(null)}
          isValidConnection={connection => { const problem = connectionProblem(circuit, { node: connection.source, pin: connection.sourceHandle ?? 'out' }, { node: connection.target, pin: connection.targetHandle ?? 'in' }, chips); connectProblemRef.current = problem; return !problem; }}
          onConnectStart={() => { connectProblemRef.current = null; }}
          onConnectEnd={() => { const problem = connectProblemRef.current; if (problem && problem in t) notify(`${t.invalidWire}: ${t[problem as keyof typeof t]}`); connectProblemRef.current = null; }}
          nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={false} deleteKeyCode={null} multiSelectionKeyCode={['Meta', 'Control', 'Shift']} selectionKeyCode="Shift" selectionOnDrag={false} selectionMode={SelectionMode.Partial} panOnDrag={[0, 1, 2]} snapToGrid={snap} snapGrid={[20, 20]} fitView fitViewOptions={{ padding: 0.28, maxZoom: 1.1 }} minZoom={0.08} maxZoom={2} proOptions={{ hideAttribution: false }} colorMode="dark">
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#253348" />
          {minimap && <MiniMap<CircuitFlowNode> nodeColor={node => node.data.component.type === 'INPUT' ? '#42d4cd' : node.data.component.type === 'OUTPUT' ? '#efb34b' : '#40526e'} maskColor="rgba(7, 13, 22, .8)" pannable zoomable />}
        </ReactFlow>
        {!circuit.components.length && <div className="nf-canvas-empty"><span className="nf-empty-mark"><Cpu size={34} /></span><h2>{t.emptyTitle}</h2><p>{t.emptyHint}</p>{!readOnly && <button className="nf-button nf-button-primary" onClick={() => place({ key: 'switch', type: 'INPUT', label: t.switch, description: '', category: 'Inputs & outputs', config: { display: 'switch' } })}><Plus size={15} />{t.emptyAction}</button>}</div>}
        <div className="nf-canvas-controls"><button className="nf-icon-button" aria-label={t.fit} title={`${t.fit} · F`} onClick={fit}><Maximize size={16} /></button><button className="nf-icon-button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => void flow.zoomIn({ duration: 160 })}><Plus size={16} /></button><button className="nf-icon-button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => void flow.zoomOut({ duration: 160 })}><span className="nf-minus">−</span></button><span />{!readOnly && <button className={`nf-icon-button${snap ? ' is-active' : ''}`} aria-label={t.snap} aria-pressed={snap} title={t.snap} onClick={() => setSnap(value => !value)}><Grid2X2 size={16} /></button>}<button className={`nf-icon-button${minimap ? ' is-active' : ''}`} aria-label={t.minimap} aria-pressed={minimap} title={t.minimap} onClick={() => setMinimap(value => !value)}><Layers size={16} /></button>{!readOnly && <button className="nf-icon-button" aria-label={t.layout} title={t.layout} onClick={() => { commit(arrangeCircuit(circuit, chips)); window.setTimeout(fit, 30); }}><LayoutGrid size={16} /></button>}</div>
        <div className="nf-canvas-status"><span className={`nf-live-dot${runtime.simulator ? '' : ' is-warning'}`} /><span>{runtime.simulator ? t.actualSimulation : t.invalidCircuit}</span></div>
        {!circuit.components.length && <div className="nf-canvas-hint"><MousePointer2 size={12} />{t.canvasHint}</div>}
      </div>
      <div className="nf-dock-tabs"><button className={dock === 'waveform' ? 'is-active' : ''} onClick={() => toggleDock('waveform')}><Activity size={14} />{t.waveform}{probes.length > 0 && <small>{probes.length}</small>}</button><button className={`${dock === 'diagnostics' ? 'is-active ' : ''}${errors.length ? 'has-errors' : ''}`} onClick={() => toggleDock('diagnostics')}>{errors.length ? <AlertCircle size={14} /> : <Check size={14} />}{t.diagnostics}<small>{runtime.diagnostics.length}</small></button>{dock === 'truth' && <button className="is-active" onClick={() => toggleDock('truth')}><Table2 size={14} />{t.truthTable}</button>}<div className="nf-toolbar-spacer" /><span className="nf-selection-count">{totalSelected ? `${totalSelected} ${t.selected}` : `${circuit.components.length} ${t.components}`}</span>{dock && <button className="nf-icon-button" aria-label={t.close} onClick={() => setDock(null)}><X size={14} /></button>}</div>
      {dock && <div className="nf-editor-dock">{dock === 'waveform' ? <WaveformPanel language={language} probes={probes} samples={runtime.samples} recording={runtime.recording} onRecordingChange={runtime.setRecording} onRemoveProbe={id => setProbes(previous => previous.filter(probe => probe.id !== id))} onClear={runtime.clearCapture} /> : dock === 'diagnostics' ? <DiagnosticsPanel diagnostics={runtime.diagnostics} language={language} onSelect={nodeId => { const topLevel = circuit.components.find(component => nodeId === component.id || nodeId.startsWith(`${component.id}/`)); if (topLevel) { setSelectedNodes(new Set([topLevel.id])); setInspectorOpen(true); void flow.fitView({ nodes: [{ id: topLevel.id }], padding: 1, duration: 200, maxZoom: 1.2 }); } }} /> : <TruthTablePanel circuit={circuit} chips={chips} language={language} />}</div>}
      </div>
      {inspectorOpen && <Inspector component={selectedComponent} wire={selectedWire} circuit={circuit} chips={chips} language={language} readOnly={readOnly} simulationReadOnly={Boolean(externalSimulator) || !runtime.simulator} canInspectLive={Boolean(runtime.simulator)} selectionCount={totalSelected} read={runtime.read} onUpdate={component => commit({ ...circuit, components: circuit.components.map(item => item.id === component.id ? component : item) })} onConnect={connectInput} onInput={runtime.setInput} onProbe={addProbe} probes={probes} onInspect={inspect} onDelete={removeSelection} onClose={() => setInspectorOpen(false)} />}
    </div>
    <div className="nf-editor-footer"><span title={t.compiledStats}><Cpu size={12} /><strong>{runtime.stats?.gates.toLocaleString() ?? '—'}</strong> {t.nandGates}</span><span><strong>{runtime.stats?.wires.toLocaleString() ?? circuit.connections.length}</strong> {t.wires}</span><span><strong>{runtime.stats?.sequential.toLocaleString() ?? '—'}</strong> {t.stateElements}</span><span title={t.depthHint}><strong>{runtime.stats?.depth.toLocaleString() ?? '—'}</strong> {t.depth}</span><div className="nf-toolbar-spacer" /><span className={errors.length ? 'nf-footer-error' : 'nf-footer-valid'}>{errors.length ? `${errors.length} ${t.errors}` : warnings.length ? `${warnings.length} ${t.warnings}` : t.noErrors}</span></div>
    {notice && <div className="nf-editor-toast" role="status">{notice}<button className="nf-icon-button" aria-label={t.close} onClick={() => setNotice('')}><X size={13} /></button></div>}
    {contextMenu && <><button className="nf-context-dismiss" aria-label={t.close} onClick={() => setContextMenu(null)} /><div className="nf-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
      <button role="menuitem" onClick={() => { copy(); setContextMenu(null); }} disabled={!selectedNodes.size}><Copy size={14} />{t.copy}<kbd>⌘C</kbd></button><button role="menuitem" onClick={() => { paste(); setContextMenu(null); }} disabled={readOnly || !clipboard?.components.length}><Copy size={14} />{t.paste}<kbd>⌘V</kbd></button><button role="menuitem" onClick={() => { duplicate(); setContextMenu(null); }} disabled={readOnly || !selectedNodes.size}><Layers size={14} />{t.duplicate}<kbd>⌘D</kbd></button><button role="menuitem" onClick={() => { setSelectedNodes(new Set(circuit.components.map(component => component.id))); setContextMenu(null); }}><MousePointer2 size={14} />{t.selectAll}<kbd>⌘A</kbd></button><hr /><button role="menuitem" disabled={readOnly || !totalSelected} onClick={removeSelection}><Trash2 size={14} />{t.remove}<kbd>⌫</kbd></button><button role="menuitem" onClick={() => { fit(); setContextMenu(null); }}><Maximize size={14} />{t.fit}<kbd>F</kbd></button>{!readOnly && <button role="menuitem" disabled={!circuit.components.length} onClick={() => { setContextMenu(null); if (window.confirm(t.clearConfirm)) { commit({ ...circuit, components: [], connections: [] }); setSelectedNodes(new Set()); setSelectedEdges(new Set()); } }}><Trash2 size={14} />{t.clearCircuit}</button>}
    </div></>}
    {chipDialog && <ChipDialog circuit={circuit} chips={chips} selection={selectedNodes} language={language} onSave={chip => { onChipsChange([...chips, chip]); notify(t.chipCreated); setPaletteOpen(true); }} onClose={() => setChipDialog(false)} />}
  </div>;
}

export default CircuitEditor;
