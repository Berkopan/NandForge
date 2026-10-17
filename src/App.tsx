import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Check, CheckCircle2, ChevronDown, CircuitBoard, Copy, Cpu, Download, FolderOpen, Globe, Home as HomeIcon, Menu, Plus, Save, Share2, Upload, X } from 'lucide-react';
import { createTemplate, type Circuit, type ChipDefinition } from './core';
import { CircuitEditor } from './editor/CircuitEditor';
import { CpuLab } from './debugger/CpuLab';
import { Home } from './views/Home';
import { Projects } from './views/Projects';
import { AcademyOverview, LessonWorkspace } from './views/Academy';
import { Documentation } from './views/Documentation';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Logo } from './components/Logo';
import { Modal } from './components/Modal';
import { LESSONS, createLessonCircuit } from './academy/lessons';
import { createProject, decodeShare, downloadText, duplicateProject, encodeShare, MAX_PROJECT_BYTES, parseProject, serializeProject, type Project } from './persistence/projects';
import { deleteProject, getUnreadableProjectCount, listProjects, readPreference, saveProject, writePreference } from './persistence/storage';
import { t, type Language, type MessageKey } from './i18n';
import { templateText } from './i18n/templates';

type View = 'home' | 'lab' | 'academy' | 'cpu' | 'projects' | 'docs';
interface Route { view: View; lessonId?: string }
function getRoute(): Route {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const candidate = parts[0];
  const view = (['lab','academy','cpu','projects','docs'].includes(candidate ?? '') ? candidate : 'home') as View;
  return { view, lessonId: view === 'academy' ? parts[1] : undefined };
}
const nav: { view: View; label: MessageKey; icon: typeof HomeIcon }[] = [
  { view:'home',label:'home',icon:HomeIcon },{ view:'lab',label:'lab',icon:CircuitBoard },{ view:'academy',label:'academy',icon:BookOpen },
  { view:'cpu',label:'cpu',icon:Cpu },{ view:'projects',label:'projects',icon:FolderOpen },{ view:'docs',label:'docs',icon:BookOpen },
];

export default function App() {
  const [language, setLanguage] = useState<Language>(() => readPreference<string>('language', 'en') === 'tr' ? 'tr' : 'en');
  const [route, setRoute] = useState<Route>(getRoute);
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved'|'saving'|'error'>('saved');
  const [completed, setCompleted] = useState<string[]>(() => {
    const saved: unknown = readPreference('academy.progress', []);
    return Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === 'string' && LESSONS.some((lesson) => lesson.id === id)))] : [];
  });
  const [toast, setToast] = useState<{ message: string; id: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<{ type: 'new'|'rename'|'delete'|'reset'; target?: Project } | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [name, setName] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const current = useRef(project); current.current = project;
  const allProjects = useRef(projects); allProjects.current = projects;
  const isDirty = useRef(dirty); isDirty.current = dirty;
  const notify = useCallback((message: string) => setToast({ message, id: Date.now() }), []);
  const tr = language === 'tr';

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    document.documentElement.lang = language;
    try { writePreference('language', language); } catch { /* The workspace reports actual project-save failures separately. */ }
  }, [language]);
  useEffect(() => {
    const handler = () => { setRoute(getRoute()); setMenu(false); };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      let existing: Project[] = [];
      try {
        existing = await listProjects();
        const unreadable = getUnreadableProjectCount();
        if (active && unreadable) notify(language === 'tr'
          ? `${unreadable} proje kaydı okunamadı. Özgün verileri korunuyor; diğer projelerini kullanabilirsin.`
          : `${unreadable} project record(s) could not be read. Their original data is preserved; your other projects are available.`);
      } catch (error) { if (active) notify(`${t(language,'storageError')} ${error instanceof Error ? error.message : ''}`); }
      if (!active) return;
      setProjects(existing);
      const lastId = readPreference<string>('lastProject', '');
      let selected = existing.find((p) => p.id === lastId) ?? existing[0] ?? createProject('Half adder', createTemplate('half-adder'));
      let changed = !existing.some((p) => p.id === selected.id);
      if (location.hash.startsWith('#share=')) {
        try { selected = duplicateProject(await decodeShare(location.hash.slice(7))); changed = true; history.replaceState(null, '', `${location.pathname}${location.search}#/lab`); setRoute({view:'lab'}); }
        catch (error) { if (active) notify(`${t(language,'generalError')}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (active) { setProject(selected); setDirty(changed); setLoading(false); }
    })();
    return () => { active = false; };
  // Initial loading has a fixed language and does not restart when the user translates the UI.
  }, []);

  const persist = useCallback(async (snapshot: Project = current.current!) => {
    if (!snapshot) return;
    setSaveStatus('saving');
    try {
      await saveProject(snapshot);
      setProjects((projects) => [snapshot, ...projects.filter((p) => p.id !== snapshot.id)].sort((a,b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)));
      if (current.current === snapshot) setDirty(false);
      setSaveStatus('saved');
      try { if (current.current?.id === snapshot.id) writePreference('lastProject', snapshot.id); } catch { /* The project itself has already committed to IndexedDB. */ }
    } catch (error) {
      setSaveStatus('error'); notify(t(language,'storageError')); throw error;
    }
  }, [language, notify]);

  useEffect(() => {
    if (!dirty || !project || loading) return;
    const timer = setTimeout(() => { void persist(project).catch(() => undefined); }, 650);
    return () => clearTimeout(timer);
  }, [dirty, project, loading, persist]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => { if (isDirty.current) { event.preventDefault(); event.returnValue = ''; } };
    const onVisibility = () => { if (document.visibilityState === 'hidden' && isDirty.current && current.current) void persist(current.current).catch(() => undefined); };
    window.addEventListener('beforeunload', onUnload); document.addEventListener('visibilitychange', onVisibility);
    return () => { window.removeEventListener('beforeunload', onUnload); document.removeEventListener('visibilitychange', onVisibility); };
  }, [persist]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void persist().catch(() => undefined); } };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [persist]);

  const change = useCallback((patch: Partial<Pick<Project,'circuit'|'chips'|'source'|'name'>>) => {
    setProject((previous) => previous ? { ...previous, ...patch, updatedAt: new Date().toISOString() } : previous);
    setDirty(true);
  }, []);
  const changeCircuit = useCallback((circuit: Circuit) => change({ circuit }), [change]);
  const changeChips = useCallback((chips: ChipDefinition[]) => change({ chips }), [change]);
  const changeSource = useCallback((source: string) => change({ source }), [change]);

  const switchProject = useCallback(async (next: Project, view?: View) => {
    const fresh = current.current?.id === next.id ? current.current : next;
    if (isDirty.current && current.current && current.current.id !== next.id) await persist(current.current);
    const opened = { ...fresh, lastOpenedAt: new Date().toISOString() };
    setProject(opened); setDirty(true);
    if (view) location.hash = view === 'home' ? '#/' : `#/${view}`;
  }, [persist]);

  const openLesson = useCallback(async (id: string, navigate = true) => {
    const lesson = LESSONS.find((lesson) => lesson.id === id);
    if (!lesson) return;
    if (current.current?.id !== `academy-${id}`) {
      const saved = allProjects.current.find((p) => p.id === `academy-${id}`);
      const next = saved ?? { ...createProject(`Academy / ${lesson.title.en}`, createLessonCircuit(lesson)), id: `academy-${id}`, source: '; Write your first program here.\n; Compute 3 + 4, output the result, then halt.\n\n' };
      await switchProject(next);
    }
    if (navigate) location.hash = `#/academy/${id}`;
  }, [switchProject]);
  useEffect(() => {
    if (!loading && route.view === 'academy' && route.lessonId) void openLesson(route.lessonId, false).catch(() => undefined);
  }, [route.view, route.lessonId, loading, openLesson]);

  const exportProject = (target: Project) => {
    const fresh = current.current?.id === target.id ? current.current : target;
    downloadText(`${fresh.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0,60) || 'project'}.nandforge.json`, serializeProject(fresh));
  };
  const importFile = async (file: File) => {
    if (file.size > MAX_PROJECT_BYTES) { notify(t(language,'fileTooLarge')); return; }
    try { const imported = duplicateProject(parseProject(await file.text())); imported.name = imported.name.replace(/ \(copy\)$/, ''); await switchProject(imported, 'lab'); notify(t(language,'importedProject')); }
    catch (error) { notify(`${t(language,'generalError')}: ${error instanceof Error ? error.message : String(error)}`); }
  };
  const copyShareLink = async (url: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setShareStatus(t(language,'shareCopied'));
    } catch { setShareStatus(tr ? 'Bağlantı alanını seçip Ctrl/Cmd+C ile kopyalayabilirsin.' : 'Select the link field and press Ctrl/Cmd+C to copy it.'); }
  };
  const shareProject = async () => {
    if (!current.current) return;
    try {
      const payload = await encodeShare(current.current);
      setShareStatus(null);
      setShareLink(`${location.origin}${location.pathname}#share=${payload}`);
    } catch (error) { notify(error instanceof Error ? error.message : String(error)); }
  };
  const createWorkspaceProject = (name: string, circuit?: Circuit) => ({
    ...createProject(name, circuit), chips: structuredClone(current.current?.chips ?? []),
  });
  const openCircuit = (circuit: Circuit) => { void switchProject(createWorkspaceProject(circuit.name, structuredClone(circuit)), 'lab').catch(() => undefined); };
  const lesson = LESSONS.find((lesson) => lesson.id === route.lessonId);
  const saveLabel = saveStatus === 'error' ? t(language,'storageError') : saveStatus === 'saving' ? t(language,'saving') : dirty ? t(language,'unsaved') : t(language,'saved');

  return <div className="app-shell">
    <a className="skip-link" href="#app-content" onClick={(event) => { event.preventDefault(); document.getElementById('app-content')?.focus(); }}>{tr ? 'İçeriğe geç' : 'Skip to content'}</a>
    <header className="app-header"><a className="brand-link" href="#/" aria-label="NandForge home"><Logo /></a><nav className={menu ? 'main-nav open' : 'main-nav'} aria-label={tr ? 'Ana gezinme' : 'Main navigation'}>{nav.map((item) => <a key={item.view} href={item.view === 'home' ? '#/' : `#/${item.view}`} className={route.view === item.view ? 'active' : ''} aria-current={route.view === item.view ? 'page' : undefined}><item.icon size={15} /><span>{t(language,item.label)}</span></a>)}</nav><div className="header-actions"><button className="language-switch" aria-label={t(language,'selectLanguage')} onClick={() => setLanguage(language === 'en' ? 'tr' : 'en')}><Globe size={14} /><span>{language.toUpperCase()}</span><ChevronDown size={11} /></button><a className="github-link" href="https://github.com/Berkopan/NandForge" target="_blank" rel="noreferrer" aria-label="GitHub repository"><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.64-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.58 9.58 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.68-4.58 4.93.36.31.68.92.68 1.85v2.76c0 .26.18.58.69.48A10 10 0 0 0 12 2Z"/></svg></a><button className="mobile-menu icon-button" aria-label={tr ? 'Menü' : 'Menu'} aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu size={20} /></button></div></header>
    <input hidden type="file" accept=".json,.nandforge.json,application/json" ref={upload} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} />
    {project && (route.view === 'lab' || route.view === 'cpu') && <div className="project-bar"><div className="project-breadcrumb"><FolderOpen size={15} /><button onClick={() => { setModal({type:'rename',target:project}); setName(project.name); }}>{project.name}<ChevronDown size={12} /></button><span>/</span><strong>{t(language,route.view === 'lab' ? 'lab' : 'cpu')}</strong></div><span className={`save-status ${dirty ? 'dirty' : ''}`} title={saveLabel}>{saveStatus === 'saving' ? <span className="spinner tiny" /> : dirty ? <i /> : <Check size={12} />}{saveLabel}</span><div className="project-actions"><button className="icon-button" title={t(language,'newProject')} aria-label={t(language,'newProject')} onClick={() => {setName('');setModal({type:'new'});}}><Plus size={15} /></button><button className="icon-button" title={t(language,'import')} aria-label={t(language,'import')} onClick={() => upload.current?.click()}><Upload size={15} /></button><button className="icon-button" title={t(language,'export')} aria-label={t(language,'export')} onClick={() => exportProject(project)}><Download size={15} /></button><button className="icon-button" title={t(language,'share')} aria-label={t(language,'share')} onClick={() => { void shareProject(); }}><Share2 size={15} /></button><button onClick={() => {void persist().catch(() => undefined);}}><Save size={14} />{t(language,'save')}</button></div></div>}
    <div id="app-content" className={`app-content view-${route.view}`} tabIndex={-1}>
      {loading || !project ? <div className="loading-workspace"><Logo /><span className="spinner" /><p>{t(language,'loading')}</p></div> : <ErrorBoundary key={`${route.view}-${route.lessonId ?? ''}-${project.id}`}>
        {route.view === 'home' && <Home language={language} onOpenCircuit={openCircuit} />}
        {route.view === 'lab' && <CircuitEditor key={project.id} circuit={project.circuit} chips={project.chips} onChange={changeCircuit} onChipsChange={changeChips} language={language} onNotify={notify} />}
        {route.view === 'cpu' && <CpuLab key={project.id} source={project.source} onSourceChange={changeSource} language={language} onNotify={notify} />}
        {route.view === 'projects' && <Projects language={language} projects={projects} onNew={() => {setName('');setModal({type:'new'});}} onOpen={(project) => {void switchProject(project,'lab').catch(() => undefined);}} onRename={(target) => {setModal({type:'rename',target});setName(target.name);}} onDuplicate={(target) => { const fresh = current.current?.id === target.id ? current.current : target; const copy = duplicateProject(fresh, `${fresh.name} (${tr ? 'kopya' : 'copy'})`); void persist(copy).then(() => notify(tr ? 'Proje çoğaltıldı.' : 'Project duplicated.')).catch(() => undefined); }} onDelete={(target) => setModal({type:'delete',target})} onExport={exportProject} onImport={() => upload.current?.click()} onTemplate={(id) => openCircuit({...createTemplate(id), ...templateText(id, language)})} />}
        {route.view === 'academy' && (!lesson ? <AcademyOverview language={language} completed={completed} onLesson={(id) => {void openLesson(id).catch(() => undefined);}} /> : project.id === `academy-${lesson.id}` ? <LessonWorkspace key={lesson.id} lesson={lesson} project={project} language={language} onCircuitChange={changeCircuit} onChipsChange={changeChips} onSourceChange={changeSource} onNotify={notify} onComplete={(id) => { setCompleted((old) => { const result = [...new Set([...old,id])]; try {writePreference('academy.progress',result);} catch {notify(tr ? 'İlerleme kaydedilemedi.' : 'Progress could not be saved.');} return result; }); void persist().catch(() => undefined); }} onReset={() => setModal({type:'reset',target:project})} onSandbox={() => {const copy = duplicateProject(project,project.circuit.name);void switchProject(copy,'lab').catch(() => undefined);}} /> : <div className="loading-workspace"><span className="spinner" /><p>{t(language,'loading')}</p></div>)}
        {route.view === 'docs' && <Documentation language={language} />}
      </ErrorBoundary>}
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={18} /><span>{toast.message}</span><button className="icon-button" aria-label={t(language,'close')} onClick={() => setToast(null)}><X size={15} /></button></div>}
    {modal && <Modal title={t(language,modal.type === 'new' ? 'newProject' : modal.type === 'rename' ? 'rename' : modal.type === 'delete' ? 'delete' : 'restore')} onClose={() => setModal(null)} closeLabel={t(language,'close')}>
      {modal.type === 'new' || modal.type === 'rename' ? <form onSubmit={(event) => { event.preventDefault(); const clean = name.trim(); if (!clean) return;
        if (modal.type === 'new') { void switchProject(createWorkspaceProject(clean),'lab').then(() => setModal(null)).catch(() => undefined); }
        else if (modal.target) { if (modal.target.id === project?.id) change({name:clean}); else void persist({...modal.target,name:clean,updatedAt:new Date().toISOString()}).catch(() => undefined); setModal(null); }
      }}><label>{t(language,'projectName')}<input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder={tr ? 'Örneğin: 8 bit toplayıcım' : 'e.g. My 8-bit adder'} required /></label><div className="modal-actions"><button type="button" onClick={() => setModal(null)}>{t(language,'cancel')}</button><button className="primary" type="submit">{t(language,modal.type === 'new' ? 'create' : 'save')}</button></div></form> : <><p>{t(language,modal.type === 'delete' ? 'deleteConfirm' : 'resetConfirm')}</p><strong>{modal.target?.name}</strong><div className="modal-actions"><button onClick={() => setModal(null)}>{t(language,'cancel')}</button><button className="danger" onClick={async () => {
        try {
        if (modal.type === 'delete' && modal.target) { await deleteProject(modal.target.id); setProjects((old) => old.filter((p) => p.id !== modal.target!.id)); if (project?.id === modal.target.id) { setProject(createProject(tr ? 'Yeni devre' : 'New circuit'));setDirty(true); } }
        if (modal.type === 'reset' && lesson) change({circuit:createLessonCircuit(lesson),source:'; Write your first program here.\n'});
        setModal(null);
        } catch (error) { notify(`${t(language,'storageError')} ${error instanceof Error ? error.message : ''}`); }
      }}>{t(language,modal.type === 'delete' ? 'delete' : 'restore')}</button></div></>}
    </Modal>}
    {shareLink && <Modal title={tr ? 'Projeyi paylaş' : 'Share project'} onClose={() => setShareLink(null)} closeLabel={t(language,'close')}>
      <p>{tr ? 'Bağlantı; devrenin, özel çiplerinin ve assembly kodunun sıkıştırılmış bir kopyasını içerir. Başka bir tarayıcıda açarak projeyi içe aktarabilirsin.' : 'The link contains a compressed copy of your circuit, custom chips and assembly source. Open it in another browser to import the project.'}</p>
      <label>{tr ? 'Paylaşım bağlantısı' : 'Share link'}<input readOnly autoFocus value={shareLink} onFocus={(event) => event.currentTarget.select()} /></label>
      {shareStatus && <p role="status">{shareStatus}</p>}
      <div className="modal-actions"><button onClick={() => { if (current.current) exportProject(current.current); }}><Download size={14} />{t(language,'export')}</button><button className="primary" onClick={() => { void copyShareLink(shareLink); }}><Copy size={14} />{tr ? 'Bağlantıyı kopyala' : 'Copy link'}</button></div>
    </Modal>}
  </div>;
}
