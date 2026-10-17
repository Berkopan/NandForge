import { useMemo, useReducer } from 'react';
import { ArrowRight, BookOpen, ChevronRight, CircuitBoard, Cpu, GitBranch, Layers, Radio, Terminal } from 'lucide-react';
import { compileCircuit, Simulator } from '../core';
import type { Circuit } from '../core/types';
import { t, type Language } from '../i18n';

export function previewCircuit(): Circuit {
  return {
    id: 'nand-and-preview', name: 'AND, made from NAND', version: 1,
    components: [
      { id: 'A', type: 'INPUT', label: 'A', position: { x: 20, y: 70 }, config: { value: 0 } },
      { id: 'B', type: 'INPUT', label: 'B', position: { x: 20, y: 240 }, config: { value: 1 } },
      { id: 'nand1', type: 'NAND', label: 'NAND 01', position: { x: 255, y: 130 }, config: {} },
      { id: 'nand2', type: 'NAND', label: 'NAND 02', position: { x: 490, y: 130 }, config: {} },
      { id: 'OUT', type: 'OUTPUT', label: 'OUT', position: { x: 730, y: 155 }, config: { display: 'led' } },
    ],
    connections: [
      { id: 'a-n1', from: { node: 'A', pin: 'out' }, to: { node: 'nand1', pin: 'a' } },
      { id: 'b-n1', from: { node: 'B', pin: 'out' }, to: { node: 'nand1', pin: 'b' } },
      { id: 'n1-n2a', from: { node: 'nand1', pin: 'out' }, to: { node: 'nand2', pin: 'a' } },
      { id: 'n1-n2b', from: { node: 'nand1', pin: 'out' }, to: { node: 'nand2', pin: 'b' } },
      { id: 'n2-out', from: { node: 'nand2', pin: 'out' }, to: { node: 'OUT', pin: 'in' } },
    ],
  };
}

function InteractivePreview({ language, onOpen }: { language: Language; onOpen: (circuit: Circuit) => void }) {
  const circuit = useMemo(previewCircuit, []);
  const simulator = useMemo(() => new Simulator(compileCircuit(circuit)), [circuit]);
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const a = simulator.read('A', 'out'); const b = simulator.read('B', 'out');
  const n1 = simulator.read('nand1', 'out'); const out = simulator.read('OUT', 'in');
  const signal = (value: number) => value ? '#42d4cd' : '#31425d';
  return <div className="hero-preview">
    <div className="preview-header"><span><i />{language === 'tr' ? 'CANLI DEVRE' : 'LIVE CIRCUIT'}</span><code>AND / NAND × 2</code><span className="preview-dots">•••</span></div>
    <div className="preview-canvas">
      <svg viewBox="0 0 510 250" aria-label={language === 'tr' ? 'İki NAND kapısından oluşturulmuş etkileşimli AND devresi' : 'Interactive AND circuit built from two NAND gates'}>
        <defs><pattern id="preview-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".75" fill="#26364e" /></pattern></defs>
        <rect width="510" height="250" fill="url(#preview-dots)" />
        <g fill="none" strokeWidth="2"><path d="M78 78H120V112H165" stroke={signal(a)} /><path d="M78 176H130V146H165" stroke={signal(b)} /><path d="M231 129H264V112H304M264 129V146H304" stroke={signal(n1)} /><path d="M370 129H417" stroke={signal(out)} /></g>
        {[165,304].map((x, index) => <g key={x}><path d={`M${x} 94h24a35 35 0 0 1 0 70h-24Z`} fill="#16263a" stroke="#4d6b85" strokeWidth="1.5"/><circle cx={x + 62} cy={129} r={5} fill="#0d1726" stroke="#4d6b85" strokeWidth="1.5"/><text x={x + 23} y={131} textAnchor="middle" fill="#b3cce0" fontSize="9" fontFamily="monospace">NAND</text><text x={x + 25} y={191} textAnchor="middle" fill="#637e9b" fontSize="8" fontFamily="monospace">0{index + 1}</text></g>)}
        <circle cx="434" cy="129" r="17" fill={out ? '#195044' : '#142338'} stroke={out ? '#42d4cd' : '#3c546e'} strokeWidth="2"/><text x="434" y="133" textAnchor="middle" fill={out ? '#77f3ce' : '#738ca9'} fontSize="12" fontFamily="monospace">{out}</text><text x="434" y="167" textAnchor="middle" fill="#7691ab" fontSize="9" fontFamily="monospace">OUT</text>
        <g fill="#8199b5" fontFamily="monospace" fontSize="10"><text x="43" y="49">A</text><text x="43" y="212">B</text></g>
      </svg>
      <button className={`preview-switch switch-a ${a ? 'on' : ''}`} aria-label={`${language === 'tr' ? 'A anahtarını değiştir' : 'Toggle input A'}: ${a}`} onClick={() => { simulator.setInput('A', 1 - a); refresh(); }}>{a}<span /></button>
      <button className={`preview-switch switch-b ${b ? 'on' : ''}`} aria-label={`${language === 'tr' ? 'B anahtarını değiştir' : 'Toggle input B'}: ${b}`} onClick={() => { simulator.setInput('B', 1 - b); refresh(); }}>{b}<span /></button>
    </div>
    <div className="preview-result"><span>{language === 'tr' ? 'Anahtarları değiştir. Sinyali izle.' : 'Flip a switch. Follow the signal.'}</span><code>A ∧ B = <b>{out}</b></code></div>
    <button className="preview-open" onClick={() => onOpen({...circuit, name: language === 'tr' ? 'NAND ile AND' : circuit.name, components: circuit.components.map((component) => component.type === 'INPUT' ? {...component, config: {...component.config, value: simulator.read(component.id, 'out')}} : component)})}>{t(language, 'openLab')}<ArrowRight size={14} /></button>
  </div>;
}

export function Home({ language, onOpenCircuit }: { language: Language; onOpenCircuit: (circuit: Circuit) => void }) {
  const tr = language === 'tr';
  return <div className="home-page">
    <div className="hero-topline"><span className="eyebrow"><i />{tr ? 'BİLGİSAYARIN İÇİNE BİR YOLCULUK' : 'A PLAYGROUND FOR THE CURIOUS'}</span><span>{tr ? 'AÇIK KAYNAK · TARAYICINDA ÇALIŞIR' : 'OPEN SOURCE · BROWSER NATIVE'}</span></div>
    <section className="hero"><div className="hero-copy"><h1>{tr ? <>Bir bilgisayar kur.<br /><em>Her bitini</em><br />anla.</> : <>Build a computer.<br />Understand<br /><em>every bit.</em></>}</h1><p>{tr ? 'Bir NAND kapısından kendi 8 bitlik bilgisayarına. Devreler oluştur, assembly yaz ve her sinyalin arkasındaki mantığı keşfet.' : 'From a single NAND gate to your own 8-bit computer. Build circuits, write assembly, and discover the logic behind every signal.'}</p><div className="hero-actions"><a className="button primary large" href="#/lab">{t(language, 'startBuilding')}<ArrowRight size={17} /></a><a className="button quiet large" href="#/academy"><BookOpen size={17} />{tr ? 'Adım adım öğren' : 'Learn step by step'}</a></div><div className="hero-footnote"><span><i />{tr ? 'Hesap gerektirmez' : 'No account needed'}</span><span>{tr ? 'Tamamen tarayıcında' : 'Runs entirely in your browser'}</span></div></div><InteractivePreview language={language} onOpen={onOpenCircuit} /></section>
    <section className="journey-strip" aria-label={tr ? 'Öğrenme yolculuğu' : 'Learning journey'}>{['NAND','GATES','MEMORY','ALU','CPU','ASSEMBLY'].map((label, index) => <div key={label}><span className="journey-index">0{index + 1}</span><strong>{tr ? ({ GATES: 'KAPILAR', MEMORY: 'BELLEK' } as Record<string,string>)[label] ?? label : label}</strong>{index < 5 && <ChevronRight size={13} />}</div>)}</section>
    <section className="home-features"><header><div><span className="eyebrow">{tr ? 'ÜÇ ALAN. TEK GERÇEK DEVRE MOTORU.' : 'THREE SPACES. ONE REAL CIRCUIT ENGINE.'}</span><h2>{tr ? 'Merakını bir sonraki seviyeye taşı.' : 'Take your curiosity one level deeper.'}</h2></div><p>{tr ? 'Her katmanı aç. Her sonucu sorgula.' : 'Open every layer. Question every result.'}</p></header><div className="feature-grid">
      <a className="feature-card" href="#/lab"><span className="feature-icon"><CircuitBoard size={24} /></span><span className="card-index">01 / {tr ? 'TASARLA' : 'BUILD'}</span><h3>{t(language, 'lab')}</h3><p>{tr ? 'Kapıları bağla, canlı sinyalleri izle ve devrelerini yeniden kullanılabilir chip’lere dönüştür.' : 'Connect gates, inspect live signals, and turn your circuits into reusable chips.'}</p><div className="feature-tags"><span>NAND</span><span>1–16 BIT</span><span>{tr ? 'ÖZEL CHIP' : 'CUSTOM CHIPS'}</span></div><strong>{tr ? 'Tezgâhını aç' : 'Open your workbench'}<ArrowRight size={15} /></strong></a>
      <a className="feature-card amber-card" href="#/cpu"><span className="feature-icon"><Cpu size={24} /></span><span className="card-index">02 / {tr ? 'PROGRAMLA' : 'PROGRAM'}</span><h3>{t(language, 'cpu')}</h3><p>{tr ? 'Gerçek bir 8 bitlik bilgisayarı programla. Yazmaçları, belleği ve kontrol sinyallerini incele.' : 'Program a real 8-bit computer. Look inside its registers, memory, and control signals.'}</p><div className="feature-tags"><span>19 {tr ? 'KOMUT' : 'INSTRUCTIONS'}</span><span>ASSEMBLY</span></div><strong>{tr ? 'CPU’yu başlat' : 'Boot the computer'}<ArrowRight size={15} /></strong></a>
      <a className="feature-card violet-card" href="#/academy"><span className="feature-icon"><BookOpen size={24} /></span><span className="card-index">03 / {tr ? 'KEŞFET' : 'UNDERSTAND'}</span><h3>{t(language, 'academy')}</h3><p>{tr ? 'İlk sinyalinden ilk programına; gerçek devreni test eden 12 uygulamalı görev.' : 'Twelve hands-on challenges, from your first signal to your first program. Your circuits are the answers.'}</p><div className="feature-tags"><span>12 {tr ? 'GÖREV' : 'CHALLENGES'}</span><span>{tr ? 'GERÇEK TESTLER' : 'REAL TESTS'}</span></div><strong>{tr ? 'Yolculuğa başla' : 'Start the journey'}<ArrowRight size={15} /></strong></a>
    </div></section>
    <section className="home-bottom"><div><Layers size={20} /><h4>{tr ? 'Her katman incelenebilir' : 'Every layer is inspectable'}</h4><p>{tr ? 'Kapıdan ALU’ya; bir bileşeni aç ve içindeki gerçek devreyi gör.' : 'From gates to the ALU: open a component and see the actual circuit inside.'}</p></div><div><GitBranch size={20} /><h4>{tr ? 'Zamanda geriye git' : 'Travel back through execution'}</h4><p>{tr ? 'Önceki bir durumu geri yükle, girişi değiştir ve yeni bir yürütme yolu dene.' : 'Restore a previous state, change an input, and explore a new execution path.'}</p></div><div><Radio size={20} /><h4>{tr ? 'Sinyali yakala' : 'Catch the signal'}</h4><p>{tr ? 'Saat, bus ve kontrol sinyallerinin gerçek örneklerini birlikte incele.' : 'Inspect real sampled clocks, buses, and control signals side by side.'}</p></div><div><Terminal size={20} /><h4>{tr ? 'Açık kaynak, sana ait' : 'Open source. Yours to explore.'}</h4><p>{tr ? 'Yerel projeler, taşınabilir JSON dosyaları ve MIT lisanslı kaynak kodu.' : 'Local projects, portable JSON files, and MIT-licensed source code.'}</p></div></section>
    <footer className="home-footer"><span>NandForge <span>·</span> {tr ? 'Bilgisayar kur. Her bitini anla.' : 'Build a computer. Understand every bit.'}</span><a href="https://github.com/Berkopan/NandForge" target="_blank" rel="noreferrer">GitHub <span>↗</span></a></footer>
  </div>;
}
