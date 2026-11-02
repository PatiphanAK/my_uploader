import { LogoMark, Wordmark } from "./Logo";

const NAV = [
  { href: "#destination", label: "Destination" },
  { href: "#files", label: "Files" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-4 px-4">
        <a href="#top" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-accent" aria-label="Tatar Upload — top">
          <LogoMark />
          <Wordmark />
        </a>
        <div className="flex items-center gap-1">
          <nav aria-label="Sections" className="hidden items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-fg-2 transition-colors hover:bg-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
              >
                {n.label}
              </a>
            ))}
          </nav>
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-elevated px-2.5 py-1 text-xs font-medium text-fg-2">
            <span aria-hidden className="size-1.5 rounded-full bg-ok" />
            Static · no server
          </span>
        </div>
      </div>
    </header>
  );
}
