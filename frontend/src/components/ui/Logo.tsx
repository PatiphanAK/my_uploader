/** Tatar Upload mark + wordmark, styled after the PatiphanAK logo (curve in a box, typewriter wordmark). */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden fill="none">
      <rect x="1" y="1" width="38" height="38" rx="3" className="fill-accent/5 stroke-accent" strokeWidth="1.5" />
      {/* a bell-like signal rising into an upload arrow */}
      <path
        d="M6 31 C 12 31, 14 22, 17 16 S 21 9, 20 9"
        className="stroke-accent-hover"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M20 9 C 21 9, 24 12, 25.5 17 S 29 31, 34 31" className="stroke-accent/60" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M20 26 V 13 M15.5 17.5 L20 13 L24.5 17.5" className="stroke-fg" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 34 H34" className="stroke-line" strokeWidth="1" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex flex-col leading-none">
      <span className="font-display text-[17px] tracking-[0.025em] text-fg">
        Tatar<span className="text-accent-hover">Upload</span>
      </span>
      <span className="mt-1 font-mono text-[9px] tracking-[0.22em] text-fg-3 uppercase">file uploader</span>
    </span>
  );
}
