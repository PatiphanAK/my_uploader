import { LogoMark, Wordmark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "#destination", index: "01", label: "destination" },
  { href: "#files", index: "02", label: "files" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-nav shadow-[0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-4xl items-center justify-between gap-4 px-4">
        <a href="#top" className="flex items-center gap-3 rounded focus-visible:outline-2 focus-visible:outline-accent" aria-label="Tatar Upload — top">
          <LogoMark />
          <Wordmark />
        </a>
        <nav aria-label="Sections" className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-md border border-transparent px-3 py-1.5 font-mono text-[11px] font-semibold tracking-[0.14em] text-fg-3 uppercase transition hover:border-accent hover:bg-accent/10 hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="mr-1 text-[9px] italic opacity-70">{n.index}.</span>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <span className="hidden rounded border border-accent/60 px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-[0.18em] text-accent-hover uppercase md:inline">
            ⚗ static · no server
          </span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
