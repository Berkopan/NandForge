import { useState } from 'react';
import { Activity, Circle, Download, Pause, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { editorText, type EditorLanguage } from './i18n';
import { formatSignal } from './model';
import { downloadText, exportWaveformCapture, waveformSegments, type SignalProbe, type WaveformSample } from './waveforms';

export interface WaveformPanelProps {
  language: EditorLanguage;
  probes: SignalProbe[];
  samples: WaveformSample[];
  recording: boolean;
  onRecordingChange(value: boolean): void;
  onRemoveProbe(id: string): void;
  onClear(): void;
}

const TRACE_COLORS = ['#42d4cd', '#efb34b', '#a78bfa', '#69aef8', '#f486ae', '#98c76a'];

export function WaveformPanel({ language, probes, samples, recording, onRecordingChange, onRemoveProbe, onClear }: WaveformPanelProps) {
  const t = editorText(language);
  const [zoom, setZoom] = useState(28);
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const [selectedProbe, setSelectedProbe] = useState('all');
  const effectiveSelection = probes.some(probe => probe.id === selectedProbe) ? selectedProbe : 'all';
  const visibleProbes = effectiveSelection === 'all' ? probes : probes.filter(probe => probe.id === effectiveSelection);
  const cursor = samples.find(sample => sample.index === cursorIndex) ?? samples.at(-1);
  const cursorOffset = cursor ? samples.indexOf(cursor) : -1;
  const width = Math.max(520, samples.length * zoom);
  const height = Math.max(72, visibleProbes.length * 43 + 31);
  const markerStride = Math.max(1, Math.ceil(64 / zoom));
  const phaseLabels = { initial: t.initialSample, input: t.inputChange, rising: t.rising, falling: t.falling };

  return <section className="nf-waveform" aria-label={t.waveform}>
    <div className="nf-wave-toolbar">
      <button className={recording ? 'nf-record-button is-recording' : 'nf-record-button'} onClick={() => onRecordingChange(!recording)} title={recording ? t.stopRecording : t.resumeRecording}>
        {recording ? <Pause size={13} /> : <Circle size={13} />}<span>{recording ? t.recording : t.record}</span>
      </button>
      <span className="nf-wave-count">{samples.length.toLocaleString()} {t.samples}</span>
      <select aria-label={t.probes} value={effectiveSelection} onChange={event => setSelectedProbe(event.target.value)}>
        <option value="all">{t.allProbes}</option>
        {probes.map(probe => <option key={probe.id} value={probe.id}>{probe.name}</option>)}
      </select>
      <div className="nf-toolbar-spacer" />
      <button className="nf-icon-button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => setZoom(value => Math.max(8, value - 8))} disabled={zoom <= 8}><ZoomOut size={15} /></button>
      <button className="nf-icon-button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => setZoom(value => Math.min(96, value + 8))} disabled={zoom >= 96}><ZoomIn size={15} /></button>
      <button className="nf-icon-button" aria-label={t.clearCapture} title={t.clearCapture} onClick={() => { onClear(); setCursorIndex(null); }} disabled={!samples.length}><Trash2 size={15} /></button>
      <button className="nf-icon-button" aria-label={t.exportCapture} title={t.exportCapture} onClick={() => downloadText(exportWaveformCapture(probes, samples), 'nandforge-waveform.json')} disabled={!samples.length}><Download size={15} /></button>
    </div>
    {!probes.length ? <div className="nf-dock-empty"><Activity size={25} /><p>{t.probeHint}</p></div> : <>
      <div className="nf-wave-body">
        <div className="nf-wave-labels">
          <div className="nf-wave-label-head">{t.liveSignals}</div>
          {visibleProbes.map((probe, index) => <div className="nf-wave-label" key={probe.id} style={{ color: TRACE_COLORS[index % TRACE_COLORS.length] }}>
            <div><strong title={probe.name}>{probe.name}</strong><small>{formatSignal(cursor?.values[probe.id], probe.width, probe.width === 1 ? 'decimal' : 'hex')} · {probe.width}b</small></div>
            <button className="nf-icon-button" title={`${t.removeProbe}: ${probe.name}`} aria-label={`${t.removeProbe}: ${probe.name}`} onClick={() => { onRemoveProbe(probe.id); if (selectedProbe === probe.id) setSelectedProbe('all'); }}><X size={12} /></button>
          </div>)}
        </div>
        <div className="nf-wave-scroll" tabIndex={0} aria-label={t.captureHint} onKeyDown={event => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const next = Math.max(0, Math.min(samples.length - 1, cursorOffset + (event.key === 'ArrowRight' ? 1 : -1)));
          if (samples[next]) setCursorIndex(samples[next].index);
        }}>
          <svg className="nf-wave-svg" width={width} height={height} aria-label={t.waveform} role="img" onClick={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const offset = Math.max(0, Math.min(samples.length - 1, Math.floor((event.clientX - bounds.left) / zoom)));
            if (samples[offset]) setCursorIndex(samples[offset].index);
          }}>
            {samples.filter((_, index) => index % markerStride === 0).map(sample => {
              const index = samples.indexOf(sample);
              return <g key={sample.index}>
                <line x1={index * zoom} x2={index * zoom} y1={23} y2={height} className="nf-wave-grid" />
                <text x={index * zoom + 5} y={17} className="nf-wave-marker">{sample.cycle}{sample.phase === 'rising' ? ' ↑' : sample.phase === 'falling' ? ' ↓' : ''}</text>
              </g>;
            })}
            {visibleProbes.map((probe, row) => {
              const baseline = 31 + row * 43;
              const color = TRACE_COLORS[row % TRACE_COLORS.length];
              const segments = waveformSegments(samples, probe.id);
              if (probe.width === 1) {
                let path = '';
                let previousValue: number | undefined;
                for (const segment of segments) {
                  if (segment.value === undefined) { previousValue = undefined; continue; }
                  const y = baseline + (segment.value ? 7 : 29);
                  path += `${previousValue === undefined ? 'M' : 'L'}${segment.start * zoom},${y} L${segment.end * zoom},${y} `;
                  previousValue = segment.value;
                }
                return <g key={probe.id}><line x1={0} x2={width} y1={baseline + 38} y2={baseline + 38} className="nf-wave-row" /><path d={path} stroke={color} fill="none" strokeWidth={2} /></g>;
              }
              return <g key={probe.id}>
                <line x1={0} x2={width} y1={baseline + 38} y2={baseline + 38} className="nf-wave-row" />
                {segments.filter(segment => segment.value !== undefined).map(segment => <g key={segment.start}>
                  <path d={`M${segment.start * zoom},${baseline + 18} L${segment.start * zoom + 4},${baseline + 6} H${segment.end * zoom - 4} L${segment.end * zoom},${baseline + 18} L${segment.end * zoom - 4},${baseline + 30} H${segment.start * zoom + 4} Z`} stroke={color} fill={color} fillOpacity={0.055} strokeWidth={1.2} />
                  {(segment.end - segment.start) * zoom > 32 && <text x={(segment.start + segment.end) * zoom / 2} y={baseline + 22} textAnchor="middle" fill={color} className="nf-wave-value">{formatSignal(segment.value, probe.width, 'hex')}</text>}
                </g>)}
              </g>;
            })}
            {cursorOffset >= 0 && <line x1={cursorOffset * zoom + zoom / 2} x2={cursorOffset * zoom + zoom / 2} y1={22} y2={height} className="nf-wave-cursor" />}
            {!samples.length && <text x={18} y={56} className="nf-wave-marker">{t.noSamples}</text>}
          </svg>
        </div>
      </div>
      <div className="nf-wave-footer"><span>{cursor ? `${t.cursor}: ${cursor.index} · ${t.cycle} ${cursor.cycle} · ${phaseLabels[cursor.phase]}` : t.captureHint}</span><span>{t.retained}</span></div>
    </>}
  </section>;
}
