import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, children, onClose, closeLabel = 'Close' }: { title: string; children: ReactNode; onClose: () => void; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog className="modal" ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) onClose(); }}>
    <div className="modal-content"><header><h2>{title}</h2><button className="icon-button" aria-label={closeLabel} onClick={onClose}><X size={18} /></button></header>{children}</div>
  </dialog>;
}
