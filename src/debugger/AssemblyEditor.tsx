import { useRef, type ReactNode } from 'react';
import type { AssemblyDiagnostic, ListingEntry } from '../assembler';
import type { Language } from '../i18n';

function highlighted(line: string): ReactNode[] {
  const commentStart = line.search(/[;#]/);
  const code = commentStart < 0 ? line : line.slice(0, commentStart);
  const comment = commentStart < 0 ? '' : line.slice(commentStart);
  const tokens = code.split(/(\b(?:NOP|LDI|LDA|STA|ADD|SUB|AND|OR|XOR|NOT|SHL|SHR|JMP|JZ|JNZ|JC|OUT|IN|HLT)\b|\b(?:0x[\da-f]+|0b[01]+|\d+)\b|[\w]+:|\.(?:ORG|EQU|WORD))/gi);
  const parts = tokens.map((token, index) => {
    const className = /:$/.test(token) ? 'syntax-label' : /^\d/.test(token) ? 'syntax-number' : /^\./.test(token) ? 'syntax-directive' : /^[A-Z]+$/i.test(token) ? 'syntax-op' : undefined;
    return <span key={index} className={className}>{token}</span>;
  });
  if (comment) parts.push(<span className="syntax-comment" key="comment">{comment}</span>);
  return parts;
}

export function AssemblyEditor({ source, onChange, listing, diagnostics, currentLine, breakpoints, onBreakpoint, language }: {
  source: string; onChange: (source: string) => void; listing: ListingEntry[]; diagnostics: AssemblyDiagnostic[];
  currentLine?: number; breakpoints: Set<number>; onBreakpoint: (address: number) => void; language: Language;
}) {
  const pre = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = source.split('\n');
  const tr = language === 'tr';
  return <div className="assembly-editor" data-testid="assembly-editor">
    <div className="assembly-gutter" ref={gutter} aria-label={tr ? 'Satır durma noktaları' : 'Line breakpoints'}>
      {lines.map((_, index) => {
        const entry = listing.find((item) => item.line === index + 1);
        const active = entry !== undefined && breakpoints.has(entry.address);
        return <button key={index} className={`${currentLine === index + 1 ? 'current-line' : ''} ${active ? 'has-breakpoint' : ''}`} disabled={!entry}
          aria-label={`${tr ? 'Durma noktası, satır' : 'Breakpoint line'} ${index + 1}`} aria-pressed={active}
          title={entry ? `${tr ? 'Durma noktası' : 'Toggle breakpoint'} @ 0x${entry.address.toString(16).padStart(2, '0').toUpperCase()}` : undefined}
          onClick={() => entry && onBreakpoint(entry.address)}><span>{active ? '●' : currentLine === index + 1 ? '▶' : ''}</span>{index + 1}</button>;
      })}
    </div>
    <div className="assembly-text">
      <pre ref={pre} aria-hidden="true">{lines.map((line, index) => <div key={index} className={currentLine === index + 1 ? 'current-source' : diagnostics.some((d) => d.line === index + 1) ? 'error-source' : ''}>{highlighted(line || ' ')}{'\n'}</div>)}</pre>
      <textarea aria-label={tr ? 'Assembly kaynak kodu' : 'Assembly source code'} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off" value={source}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => { if (pre.current) { pre.current.scrollTop = event.currentTarget.scrollTop; pre.current.scrollLeft = event.currentTarget.scrollLeft; } if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }}
        onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); const target = event.currentTarget; const start = target.selectionStart; const end = target.selectionEnd; onChange(`${source.slice(0, start)}  ${source.slice(end)}`); requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = start + 2; }); } }} />
    </div>
  </div>;
}
