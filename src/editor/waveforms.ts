export interface SignalProbe {
  id: string;
  nodeId: string;
  pin: string;
  name: string;
  width: number;
}

export type SamplePhase = 'initial' | 'input' | 'rising' | 'falling';

export interface WaveformSample {
  index: number;
  cycle: number;
  phase: SamplePhase;
  values: Record<string, number>;
}

export const MAX_WAVEFORM_SAMPLES = 1024;

export function appendSamples(existing: WaveformSample[], incoming: WaveformSample[], maximum = MAX_WAVEFORM_SAMPLES): WaveformSample[] {
  if (incoming.length >= maximum) return incoming.slice(-maximum);
  return [...existing.slice(Math.max(0, existing.length + incoming.length - maximum)), ...incoming];
}

export function probeId(nodeId: string, pin: string): string {
  return JSON.stringify([nodeId, pin]);
}

export function waveformSegments(samples: WaveformSample[], id: string): { start: number; end: number; value: number | undefined }[] {
  const segments: { start: number; end: number; value: number | undefined }[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]!.values[id];
    const previous = segments.at(-1);
    if (previous && previous.value === value) previous.end = index + 1;
    else segments.push({ start: index, end: index + 1, value });
  }
  return segments;
}

export function exportWaveformCapture(probes: SignalProbe[], samples: WaveformSample[]): string {
  return JSON.stringify({
    format: 'nandforge-waveform',
    version: 1,
    description: 'Actual simulator samples. index is monotonically increasing within one capture; cycle is the simulator clock step; phase identifies the observed event. Missing signal values mean the probe was not present at that sample.',
    capacity: MAX_WAVEFORM_SAMPLES,
    signals: probes,
    samples,
  }, null, 2);
}

export function downloadText(contents: string, name: string, mime = 'application/json'): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
