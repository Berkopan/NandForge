import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Lightbulb, Play, RotateCcw, TestTube2 } from 'lucide-react';
import { LESSONS, type Lesson } from '../academy/lessons';
import { verifyLesson, type VerificationResult } from '../academy/verify';
import { CircuitEditor } from '../editor/CircuitEditor';
import { CpuLab } from '../debugger/CpuLab';
import { local, t, type Language } from '../i18n';
import type { Project } from '../persistence/projects';
import type { ChipDefinition, Circuit } from '../core/types';

export function AcademyOverview({ language, completed, onLesson }: { language: Language; completed: string[]; onLesson: (id: string) => void }) {
  const tr = language === 'tr';
  return <div className="academy-page content-page"><header className="page-intro"><div><span className="eyebrow">{tr ? 'YAPARAK ÖĞREN' : 'UNDERSTANDING, BY BUILDING'}</span><h1>{t(language, 'learnPath')}</h1><p>{t(language, 'learnIntro')}</p></div><div className="academy-progress"><strong>{completed.length}<span>/ {LESSONS.length}</span></strong><p>{t(language, 'completed')}</p><div><i style={{ width: `${completed.length / LESSONS.length * 100}%` }} /></div></div></header>
    {[0, 5, 9].map((start, group) => <section className="lesson-section" key={start}><h2>{local(language, LESSONS[start]!.category)}</h2><div className="lesson-grid">{LESSONS.slice(start, [5,9,12][group]).map((lesson) => <button className={`lesson-card ${completed.includes(lesson.id) ? 'complete' : ''}`} key={lesson.id} onClick={() => onLesson(lesson.id)}><div className="lesson-card-top"><span>{String(lesson.number).padStart(2,'0')}</span>{completed.includes(lesson.id) ? <CheckCircle2 size={20} /> : <Circle size={20} />}</div><h3>{local(language, lesson.title)}</h3><p>{local(language, lesson.objective)}</p><strong>{completed.includes(lesson.id) ? t(language, 'resumeLesson') : t(language, 'startLesson')}<ArrowRight size={15} /></strong></button>)}</div></section>)}
    <p className="academy-local-note">{t(language, 'progressSaved')}</p>
  </div>;
}

export function LessonWorkspace({ lesson, project, language, onCircuitChange, onChipsChange, onSourceChange, onComplete, onReset, onSandbox, onNotify }: {
  lesson: Lesson; project: Project; language: Language; onCircuitChange: (circuit: Circuit) => void; onChipsChange: (chips: ChipDefinition[]) => void; onSourceChange: (source: string) => void;
  onComplete: (id: string) => void; onReset: () => void; onSandbox: () => void; onNotify: (message: string) => void;
}) {
  const [hint, setHint] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [verification, setVerification] = useState<{ result: VerificationResult; solution: Project } | null>(null);
  // A delayed verification belongs to the solution that was actually tested.
  // Resetting or editing that solution must not display an older success banner.
  const result = verification && verification.solution.circuit === project.circuit
    && verification.solution.chips === project.chips && verification.solution.source === project.source
    ? verification.result : null;
  const setResult = (result: VerificationResult | null) => setVerification(result ? { result, solution: project } : null);
  const [verifying, setVerifying] = useState(false);
  const tr = language === 'tr';
  const verify = () => {
    setVerifying(true);
    window.setTimeout(() => {
      const checked = verifyLesson(lesson, project.circuit, project.chips, language);
      setResult(checked); setVerifying(false);
      if (checked.ok) onComplete(lesson.id);
    }, 20);
  };
  return <div className="lesson-workspace"><header className="lesson-topbar"><a href="#/academy"><ArrowLeft size={16} />{t(language, 'backAcademy')}</a><div><span>{String(lesson.number).padStart(2,'0')} / 12</span><h1>{local(language, lesson.title)}</h1></div><button className="icon-button" aria-label={tr ? 'Yönergeleri göster/gizle' : 'Show or hide instructions'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><ChevronDown size={18} /></button></header>
    {expanded && <section className="lesson-guide"><div><h3>{t(language, 'foundation')}</h3><p>{local(language, lesson.foundation)}</p></div><div><h3>{t(language, 'objective')}</h3><p>{local(language, lesson.instructions)}</p><p className="expected-behavior">{local(language, lesson.expected)}</p></div><div className="lesson-guide-actions">{lesson.kind !== 'program' && <button className="primary" disabled={verifying} onClick={verify}><TestTube2 size={15} />{t(language, verifying ? 'verifying' : 'verify')}</button>}<button onClick={() => setHint(!hint)}><Lightbulb size={15} />{t(language, hint ? 'hideHint' : 'hint')}</button><button onClick={onSandbox}><Play size={14} />{t(language, 'continueLab')}</button><button className="quiet" onClick={onReset}><RotateCcw size={13} />{t(language, 'resetLesson')}</button></div>{hint && <p className="lesson-hint"><Lightbulb size={16} />{local(language, lesson.hint)}</p>}</section>}
    {result && <div className={`lesson-result ${result.ok ? 'success' : 'failure'}`} role="status"><span>{result.ok ? <Check size={19} /> : <TestTube2 size={19} />}</span><div><strong>{result.ok ? t(language, 'success') : (tr ? 'Birlikte düzeltelim' : 'A clue for your next attempt')}</strong><p>{result.message}</p>{result.inputs && <code>{t(language,'input')}: {JSON.stringify(result.inputs)} · {t(language,'expected')}: {JSON.stringify(result.expected)} · {t(language,'actual')}: {JSON.stringify(result.actual)}</code>}</div>{result.ok && lesson.number < LESSONS.length && <a className="button" href={`#/academy/${LESSONS[lesson.number]!.id}`}>{t(language,'nextLesson')}<ArrowRight size={14} /></a>}</div>}
    {lesson.kind === 'program' ? <CpuLab source={project.source} onSourceChange={onSourceChange} language={language} onNotify={onNotify} onVerified={(output, halted) => {
      const ok = halted && output === 7;
      setResult({ ok, tested: 1, message: ok ? (tr ? 'Gerçek CPU, OUT = 7 ile durdu. İlk programın çalışıyor.' : 'The real CPU halted with OUT = 7. Your first program works.') : (tr ? `CPU çıkışı ${output}. Önce programı yükleyip HLT komutuna kadar çalıştır; beklenen çıkış 7.` : `CPU output is ${output}. Load and run your program through HLT; the expected output is 7.`) });
      if (ok) onComplete(lesson.id);
    }} /> : <CircuitEditor circuit={project.circuit} chips={project.chips} onChange={(circuit) => { setResult(null); onCircuitChange(circuit); }} onChipsChange={(chips) => { setResult(null); onChipsChange(chips); }} language={language} onNotify={onNotify} />}
  </div>;
}
