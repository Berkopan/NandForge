import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftToLine, ArrowRightToLine, BookOpen, Braces, CheckCircle2, ChevronDown, Circle, Cpu, Download, Play, Pause, Plus, RotateCcw, SkipForward, Terminal, X } from 'lucide-react';
import { assemble, EXAMPLE_PROGRAMS, type AssemblyResult } from '../assembler';
import { CPU_SUBSYSTEMS, disassemble } from '../cpu';
import { getComponentSpec } from '../core';
import { CircuitEditor } from '../editor/CircuitEditor';
import { WaveformPanel } from '../editor/WaveformPanel';
import { probeId, type SignalProbe } from '../editor/waveforms';
import { t, type Language } from '../i18n';
import { aluOperationName, cpuText, instructionDescription } from '../i18n/cpu';
import { downloadText } from '../persistence/projects';
import { DebuggerSession } from './session';
import { AssemblyEditor } from './AssemblyEditor';
import { CpuDiagram } from './CpuDiagram';
import './cpu.css';

const hex = (value: number, width = 2) => value.toString(16).padStart(width, '0').toUpperCase();
type BottomTab = 'waveform' | 'memory' | 'machineCode' | 'execution' | 'history';

export function CpuLab({ source, onSourceChange, language, onNotify, onVerified }: {
  source: string; onSourceChange: (source: string) => void; language: Language; onNotify: (message: string) => void; onVerified?: (output: number, halted: boolean) => void;
}) {
  const [session] = useState(() => {
    const instance = new DebuggerSession();
    const assembly = assemble(source);
    if (assembly.ok) instance.load(assembly.rom);
    return instance;
  });
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const [assembly, setAssembly] = useState<AssemblyResult>(() => assemble(source));
  const [loadedSource, setLoadedSource] = useState(source);
  const [running, setRunning] = useState(false);
  const runTimer = useRef<number | null>(null);
  const runGeneration = useRef(0);
  const [speed, setSpeed] = useState(5);
  const [selectedSubsystem, setSelectedSubsystem] = useState('alu');
  const [inspecting, setInspecting] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>('waveform');
  const [selectedExample, setSelectedExample] = useState('');
  const [watchAddress, setWatchAddress] = useState('240');
  const [probeChoice, setProbeChoice] = useState('');
  const [memoryMode, setMemoryMode] = useState<'hex' | 'decimal'>('hex');
  const state = useMemo(() => session.state, [session, revision]);
  const stats = session.machine.simulator.compiled.stats;
  const tr = language === 'tr';
  const dirtySource = source !== loadedSource;
  const loaded = assembly.ok && !dirtySource;
  const currentListing = loaded ? assembly.listing.find((line) => line.address === state.pc) : undefined;
  const previousState = session.history[Math.max(0, session.historyIndex - 1)]?.state;
  const availableProbes = useMemo(() => session.machine.circuit.components.flatMap((component) => getComponentSpec(component, session.machine.chips).outputs.map((pin): SignalProbe => ({
    id: probeId(component.id, pin.name), nodeId: component.id, pin: pin.name, name: `${component.label ?? component.id}.${pin.name}`, width: pin.width,
  }))), [session]);

  const stopRunning = useCallback(() => {
    runGeneration.current += 1;
    if (runTimer.current !== null) {
      window.clearInterval(runTimer.current);
      runTimer.current = null;
    }
    setRunning(false);
  }, []);

  const load = useCallback((program = source) => {
    stopRunning();
    const result = assemble(program); setAssembly(result);
    if (!result.ok) { onNotify(t(language, 'assembleFailed')); return; }
    session.load(result.rom); setLoadedSource(program); refresh(); onNotify(t(language, 'programLoaded'));
  }, [source, session, language, onNotify, stopRunning]);

  const toggleRun = useCallback(() => {
    if (running) { stopRunning(); return; }
    if (!loaded || state.halted) return;
    session.beginRun(); setRunning(true);
  }, [running, loaded, state.halted, session, stopRunning]);

  useEffect(() => {
    if (!running) return;
    const generation = ++runGeneration.current;
    const frequency = Math.min(speed, 30);
    let accumulated = 0;
    const timer = window.setInterval(() => {
      if (generation !== runGeneration.current) return;
      accumulated += speed / frequency;
      const count = Math.floor(accumulated);
      accumulated -= count;
      const reason = session.runSlice(count); refresh();
      if (reason) {
        stopRunning();
        if (reason === 'breakpoint') onNotify(t(language, 'breakpointHit'));
        if (reason === 'watchpoint') onNotify(t(language, 'watchpointHit'));
        if (reason === 'limit') onNotify(t(language, 'stepLimit'));
      }
    }, 1000 / frequency);
    runTimer.current = timer;
    return () => {
      window.clearInterval(timer);
      if (runTimer.current === timer) {
        runTimer.current = null;
        runGeneration.current += 1;
      }
    };
  }, [running, speed, session, language, onNotify, stopRunning]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); load(); }
      if (event.key === 'F5') { event.preventDefault(); toggleRun(); }
      if (event.key === 'F10') {
        event.preventDefault(); stopRunning();
        if (event.shiftKey) session.backward(); else if (loaded) session.step();
        refresh();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [load, toggleRun, session, loaded, stopRunning]);

  const toggleBreakpoint = (address: number) => {
    if (session.breakpoints.has(address)) session.breakpoints.delete(address); else session.breakpoints.add(address);
    refresh();
  };
  const toggleWatchpoint = (address: number) => {
    if (session.watchpoints.has(address)) session.watchpoints.delete(address); else session.watchpoints.add(address);
    refresh();
  };
  const selected = session.machine.circuit.components.find((component) => component.id === selectedSubsystem)!;
  const selectedSpec = getComponentSpec(selected, session.machine.chips);
  const subsystem = CPU_SUBSYSTEMS.find((item) => item.nodeId === selectedSubsystem)!;
  const changedMemory = session.log.find((entry) => entry.cycle === state.cycles)?.memoryChanges ?? [];

  if (inspecting) return <section className="cpu-inspection"><header><button onClick={() => setInspecting(false)}><ArrowLeft size={16} />{t(language, 'returnCpu')}</button><p>{tr ? 'Aynı CPU örneğinin canlı sinyalleri. Alt devreleri bileşen denetçisinden açabilirsin.' : 'Live signals from this CPU instance. Open subsystems from the component inspector.'}</p></header>
    <CircuitEditor circuit={session.machine.circuit} chips={session.machine.chips} onChange={() => undefined} onChipsChange={() => undefined} language={language} readOnly externalSimulator={session.machine.simulator} externalRevision={revision} onNotify={onNotify} />
  </section>;

  return <section className="cpu-lab">
    <div className="cpu-toolbar">
      <div className="cpu-title"><Cpu size={19} /><strong>NAND-8</strong><span className={`status-pill ${state.fault ? 'fault' : state.halted ? 'halted' : running ? 'running' : ''}`}><i />{state.fault ? t(language, 'fault') : state.halted ? t(language, 'halted') : running ? t(language, 'running') : t(language, 'ready')}</span></div>
      <div className="cpu-transport">
        <button className="icon-button" title={`${t(language, 'back')} · Shift F10`} aria-label={t(language, 'back')} disabled={session.historyIndex === 0} onClick={() => { stopRunning(); session.backward(); refresh(); }}><ArrowLeftToLine size={17} /></button>
        <button title="F10" disabled={!loaded || state.halted || running} onClick={() => { session.step(); refresh(); }}><SkipForward size={17} />{t(language, 'step')}</button>
        <button className={running ? 'amber' : 'primary'} title="F5" disabled={!loaded || state.halted} onClick={toggleRun}>{running ? <Pause size={16} /> : <Play size={16} />}{t(language, running ? 'pause' : 'run')}</button>
        <button className="icon-button" title={t(language, 'reset')} aria-label={t(language, 'reset')} onClick={() => { stopRunning(); session.reset(); refresh(); }}><RotateCcw size={16} /></button>
        <label className="speed-control">{t(language, 'speed')} <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{[1, 2, 5, 10, 25, 50, 100, 250, 1000].map((speed) => <option key={speed} value={speed}>{speed} Hz</option>)}</select></label>
      </div>
      <span className="cycle-counter">{t(language, 'cycles')} <strong data-testid="cpu-cycle">{state.cycles.toLocaleString()}</strong></span>
    </div>
    <div className="cpu-main-grid">
      <aside className="cpu-code-pane">
        <header className="pane-header"><span><Terminal size={16} />{t(language, 'source')}</span><kbd>⌘/Ctrl ↵</kbd></header>
        <label className="example-select"><BookOpen size={14} /><select aria-label={t(language, 'examples')} value={selectedExample} onChange={(event) => {
          const program = EXAMPLE_PROGRAMS.find((example) => example.id === event.target.value); if (!program) return;
          setSelectedExample(program.id); onSourceChange(program.source); load(program.source);
          if (program.input !== undefined) { session.setInput(program.input); refresh(); }
        }}><option value="">{t(language, 'examples')}</option>{EXAMPLE_PROGRAMS.map((example) => <option key={example.id} value={example.id}>{tr ? example.nameTr : example.name}</option>)}</select><ChevronDown size={13} /></label>
        {selectedExample && <p className="example-description">{EXAMPLE_PROGRAMS.find((p) => p.id === selectedExample)?.[tr ? 'descriptionTr' : 'description']}</p>}
        <AssemblyEditor source={source} onChange={(value) => { stopRunning(); onSourceChange(value); }} listing={loaded ? assembly.listing : []} diagnostics={assembly.diagnostics} currentLine={currentListing?.line} breakpoints={session.breakpoints} onBreakpoint={toggleBreakpoint} language={language} />
        <div className="assemble-actions"><button className="primary" onClick={() => load()}><Braces size={16} />{t(language, 'load')}</button><button className="icon-button" aria-label={t(language, 'export')} title={t(language, 'export')} onClick={() => downloadText('program.asm', source, 'text/plain')}><Download size={16} /></button></div>
        {dirtySource && <p className="inline-notice amber-text">{t(language, 'programChanged')}</p>}
        {!!assembly.diagnostics.length && <ul className="assembly-errors" role="alert">{assembly.diagnostics.map((diagnostic, index) => <li key={index}><strong>{diagnostic.line}:{diagnostic.column}</strong> {tr ? 'Derleme hatası: ' : ''}{diagnostic.message}</li>)}</ul>}
        <div className="breakpoint-summary"><h4><Circle size={11} />{t(language, 'breakpoints')}</h4>{session.breakpoints.size ? [...session.breakpoints].sort((a, b) => a - b).map((address) => <button key={address} onClick={() => toggleBreakpoint(address)}>0x{hex(address)} <X size={11} /></button>) : <p>{tr ? 'Satır numarasına tıklayarak durma noktası ekle.' : 'Click a line number to set a breakpoint.'}</p>}</div>
        {onVerified && <button className="verify-program" disabled={!loaded} onClick={() => onVerified(state.output, state.halted && !state.fault)}><CheckCircle2 size={17} />{t(language, 'verify')}</button>}
      </aside>
      <main className="cpu-datapath-pane">
        <header className="pane-header"><span><Cpu size={16} />{tr ? 'Canlı veri yolu' : 'Live datapath'}</span><small>{tr ? 'Bir komut · bir yükselen kenar' : 'One instruction · one rising edge'}</small></header>
        <div className="current-instruction"><span>PC <b data-testid="cpu-pc">0x{hex(state.pc)}</b></span><strong>{disassemble(state.instruction)}</strong><code>0x{hex(state.instruction, 4)}</code></div>
        <CpuDiagram state={state} language={language} selected={selectedSubsystem} onSelect={setSelectedSubsystem} />
        <div className="subsystem-inspector">
          <header><strong>{tr ? subsystem.nameTr : subsystem.name}</strong><button onClick={() => { stopRunning(); setInspecting(true); }}>{t(language, 'inspect')} <span aria-hidden="true">↗</span></button></header>
          <div className="signal-pills">{[...selectedSpec.inputs, ...selectedSpec.outputs].map((pin) => <button key={`${pin.name}`} title={`${tr ? 'Prob ekle' : 'Add probe'}: ${selectedSubsystem}.${pin.name}`} onClick={() => {
            session.addProbe({ id: probeId(selectedSubsystem, pin.name), nodeId: selectedSubsystem, pin: pin.name, name: `${selectedSubsystem}.${pin.name}`, width: pin.width }); setBottomTab('waveform'); refresh();
          }}><span>{pin.name}</span><code>{pin.width === 1 ? session.machine.simulator.read(selectedSubsystem, pin.name) : `0x${hex(session.machine.simulator.read(selectedSubsystem, pin.name))}`}</code><Plus size={10} /></button>)}</div>
        </div>
        <div className="cpu-stats"><span>{stats.gates.toLocaleString()} {t(language, 'gates')}</span><span>{stats.sequential} {t(language, 'sequential')}</span><span>{t(language, 'depth')} {stats.depth}</span><span>{tr ? 'Mantıksal ölçüm; fiziksel gecikme değil.' : 'Logical depth; not physical timing.'}</span></div>
      </main>
      <aside className="cpu-register-pane">
        <header className="pane-header"><span>{t(language, 'registers')}</span><small>8-bit</small></header>
        <div className={`accumulator ${previousState && previousState.a !== state.a ? 'changed' : ''}`}><span>{cpuText(language, 'accumulator')} <b>A</b></span><strong data-testid="cpu-a">{state.a}<small>0x{hex(state.a)}</small></strong><div className="binary-bits">{state.a.toString(2).padStart(8, '0').split('').map((bit, i) => <i key={i} className={bit === '1' ? 'bit-on' : ''}>{bit}</i>)}</div></div>
        <div className="flag-registers"><div className={state.z ? 'active' : ''}><span>{cpuText(language, 'zero')}</span><b>Z</b><strong data-testid="cpu-z">{state.z}</strong></div><div className={state.c ? 'active' : ''}><span>{cpuText(language, 'carry')}</span><b>C</b><strong data-testid="cpu-c">{state.c}</strong></div></div>
        <div className="output-register"><span>{t(language, 'output')} <code>OUT</code></span><strong data-testid="cpu-output">{state.output}</strong><small>0x{hex(state.output)} · {state.output.toString(2).padStart(8, '0')}</small></div>
        <label className="external-input"><span>{t(language, 'input')} <code>IN</code></span><input type="number" min={0} max={255} value={state.input} onChange={(event) => { const value = Number(event.target.value); if (!Number.isInteger(value) || value < 0 || value > 255) return; stopRunning(); session.setInput(value); refresh(); }} /><small>0–255 · 0x{hex(state.input)}</small></label>
        <div className="operation-card"><h4>{t(language, 'operation')}</h4><p>{instructionDescription(language, state.opcode)}</p><code>{cpuText(language, 'aluSelection')} · {aluOperationName(language, state.aluOperation)}</code></div>
        <div className="control-registers"><h4>{t(language, 'controls')}</h4>{Object.entries(state.control).filter(([key]) => key !== 'aluOp').map(([key, value]) => <span key={key} className={value ? 'enabled' : ''}><i />{key}<b>{value}</b></span>)}</div>
      </aside>
    </div>
    <div className="cpu-bottom-pane">
      <div className="cpu-bottom-tabs" role="tablist" aria-label={tr ? 'Hata ayıklama araçları' : 'Debugger tools'}>{(['waveform','memory','machineCode','execution','history'] as const).map((tab) => <button role="tab" aria-selected={bottomTab === tab} key={tab} className={bottomTab === tab ? 'active' : ''} onClick={() => setBottomTab(tab)}>{t(language, tab)}{tab === 'history' && <small>{session.history.length}</small>}</button>)}</div>
      {bottomTab === 'waveform' && <div role="tabpanel"><div className="probe-selector"><label>{t(language, 'probe')}<select value={probeChoice} onChange={(event) => setProbeChoice(event.target.value)}><option value="">{tr ? 'Bir sinyal seç' : 'Choose a signal'}</option>{availableProbes.filter((p) => !session.probes.some((probe) => probe.id === p.id)).map((probe) => <option key={probe.id} value={probe.id}>{probe.name} · {probe.width}b</option>)}</select></label><button disabled={!probeChoice || session.probes.length >= 24} onClick={() => { const probe = availableProbes.find((p) => p.id === probeChoice); if (probe) session.addProbe(probe); setProbeChoice(''); refresh(); }}><Plus size={13} />{t(language, 'add')}</button></div>
        <WaveformPanel language={language} probes={session.probes} samples={session.samples} recording={session.recording} onRecordingChange={(value) => { session.recording = value; refresh(); }} onRemoveProbe={(id) => { session.removeProbe(id); refresh(); }} onClear={() => { session.clearCapture(); refresh(); }} /></div>}
      {bottomTab === 'memory' && <div className="memory-panel" role="tabpanel"><div className="memory-grid-wrap"><div className="memory-toolbar"><strong>RAM · 256 × 8</strong><select aria-label={tr ? 'Bellek sayı tabanı' : 'Memory number format'} value={memoryMode} onChange={(event) => setMemoryMode(event.target.value as 'hex' | 'decimal')}><option value="hex">Hex</option><option value="decimal">Decimal</option></select><span>{tr ? 'İzleme noktası için bir hücreye tıkla.' : 'Click a cell to toggle a watchpoint.'}</span></div><div className="memory-grid">{state.ram.map((value, address) => <button key={address} title={`RAM[${address}] / 0x${hex(address)} = ${value}${session.watchpoints.has(address) ? ' · watchpoint' : ''}`} aria-label={`RAM ${address}: ${value}`} aria-pressed={session.watchpoints.has(address)} className={`${session.watchpoints.has(address) ? 'watched' : ''} ${changedMemory.includes(address) ? 'changed' : ''} ${value ? 'nonzero' : ''}`} onClick={() => toggleWatchpoint(address)}><small>{hex(address)}</small>{memoryMode === 'hex' ? hex(value) : value}</button>)}</div></div><aside className="watchpoint-panel"><h4>{t(language, 'watchpoints')}</h4><form onSubmit={(event) => { event.preventDefault(); const address = Number(watchAddress); if (Number.isInteger(address) && address >= 0 && address <= 255) { session.watchpoints.add(address); refresh(); } }}><input aria-label={t(language, 'address')} type="number" min={0} max={255} value={watchAddress} onChange={(event) => setWatchAddress(event.target.value)} /><button type="submit"><Plus size={14} />{t(language, 'add')}</button></form>{[...session.watchpoints].sort((a,b) => a-b).map((address) => <button className="watch-chip" key={address} onClick={() => toggleWatchpoint(address)}>RAM[0x{hex(address)}] = {state.ram[address]} <X size={12} /></button>)}</aside></div>}
      {bottomTab === 'machineCode' && <div className="listing-panel" role="tabpanel"><table><thead><tr><th>{t(language, 'address')}</th><th>HEX</th><th>BINARY</th><th>{t(language, 'instruction')}</th><th>{tr ? 'Satır' : 'Line'}</th></tr></thead><tbody>{assembly.listing.map((entry) => <tr key={entry.address} className={state.pc === entry.address ? 'current-row' : ''}><td><button onClick={() => toggleBreakpoint(entry.address)} aria-label={`${t(language, 'breakpoints')} 0x${hex(entry.address)}`}>{session.breakpoints.has(entry.address) ? '● ' : ''}0x{hex(entry.address)}</button></td><td>{hex(entry.word, 4)}</td><td>{entry.word.toString(2).padStart(16, '0').replace(/(.{8})/, '$1 ')}</td><td>{disassemble(entry.word)}</td><td>{entry.line}</td></tr>)}</tbody></table></div>}
      {bottomTab === 'execution' && <div className="execution-panel" role="tabpanel">{session.log.length ? [...session.log].reverse().map((entry) => <div key={`${entry.cycle}-${entry.pc}`}><span>#{entry.cycle}</span><code>{hex(entry.pc)} · {entry.instruction}</code><p>{entry.changes.join(' · ') || (tr ? 'Yazmaç değişimi yok' : 'No register changes')}</p></div>) : <p className="empty-note">{t(language, 'noHistory')}</p>}</div>}
      {bottomTab === 'history' && <div className="history-panel" role="tabpanel"><p>{t(language, 'branchHistory')}</p><div className="history-scrubber"><button aria-label={t(language, 'back')} disabled={session.historyIndex === 0} onClick={() => { stopRunning(); session.backward(); refresh(); }}><ArrowLeftToLine size={17} /></button><input aria-label={t(language, 'history')} type="range" min={0} max={Math.max(0, session.history.length - 1)} value={session.historyIndex} onChange={(event) => { stopRunning(); session.restore(Number(event.target.value)); refresh(); }} /><button aria-label={t(language, 'forward')} disabled={session.historyIndex === session.history.length - 1} onClick={() => { stopRunning(); session.forward(); refresh(); }}><ArrowRightToLine size={17} /></button><strong>#{state.cycles}</strong></div><div className="history-cards">{session.history.map((entry, index) => <button key={`${index}-${entry.state.cycles}`} className={index === session.historyIndex ? 'active' : ''} onClick={() => { stopRunning(); session.restore(index); refresh(); }}><small>#{entry.state.cycles}</small><strong>{entry.label}</strong><span>A {entry.state.a} · PC {entry.state.pc} · OUT {entry.state.output}</span></button>)}</div></div>}
    </div>
  </section>;
}
