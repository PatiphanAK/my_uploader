/** Tatar Upload mark: an upload arrow in a rounded indigo tile. */
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden fill="none">
      <rect width="40" height="40" rx="10" className="fill-accent" />
      <path d="M20 27V13M14 18.5 20 12.5l6 6" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 29h16" stroke="#fff" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="text-[15px] font-semibold tracking-tight text-fg">
      Tatar <span className="text-accent">Upload</span>
    </span>
  );
}
