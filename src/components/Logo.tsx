export function Logo({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><svg viewBox="0 0 64 64" width="34" height="34" aria-hidden="true"><path d="M12 13h18a19 19 0 0 1 0 38H12V13Z" fill="none" stroke="currentColor" strokeWidth="4"/><circle cx="54" cy="32" r="5" fill="var(--amber)"/><path d="M2 23h10M2 41h10M59 32h5" stroke="currentColor" strokeWidth="4"/></svg>{!compact && <span>Nand<span className="brand-light">Forge</span></span>}</span>;
}
