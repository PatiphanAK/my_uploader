"use client";

import { Button as HButton, type ButtonProps as HButtonProps } from "@headlessui/react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

// Portfolio-style controls: outlined, monospace, uppercase, with a soft glow.
const VARIANTS: Record<Variant, string> = {
  primary:
    "border border-accent bg-accent/10 text-accent-hover data-hover:bg-accent/20 data-hover:shadow-glow-strong",
  secondary: "border border-line text-fg-2 data-hover:border-accent data-hover:text-accent-hover",
  ghost: "border border-transparent text-fg-3 data-hover:border-line-muted data-hover:text-fg",
  danger: "border border-transparent text-err/90 data-hover:border-err/40 data-hover:bg-err/10 data-hover:text-err",
};

export interface ButtonProps extends Omit<HButtonProps, "className" | "children"> {
  variant?: Variant;
  size?: "sm" | "md";
  icon?: LucideIcon;
  className?: string;
  children?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", icon: Icon, className, children, ...rest }: ButtonProps) {
  return (
    <HButton
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded font-mono font-semibold tracking-[0.12em] uppercase transition",
        "focus:outline-none data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent",
        "data-disabled:cursor-not-allowed data-disabled:opacity-40 data-disabled:shadow-none",
        size === "sm" ? "h-7 px-2.5 text-[10px]" : "h-9 px-3.5 text-[11px]",
        VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} />}
      {children}
    </HButton>
  );
}

/** Card with a numbered monospace heading, like the portfolio's "01. about" nav items. */
export function Panel({
  id,
  index,
  title,
  actions,
  children,
  className,
}: {
  id?: string;
  index?: string;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cx(
        "scroll-mt-20 rounded-lg border border-line-muted bg-elevated/80 p-4 backdrop-blur-sm sm:p-5",
        className,
      )}
    >
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="label-mono">
              {index && <span className="mr-1.5 text-accent/70 italic">{index}.</span>}
              <span className="font-semibold text-fg-2">{title}</span>
            </h2>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "border-line text-fg-2",
  info: "border-accent/50 bg-accent/10 text-accent-hover",
  success: "border-ok/40 bg-ok/10 text-ok",
  warning: "border-warn/40 bg-warn/10 text-warn",
  danger: "border-err/40 bg-err/10 text-err",
};

/** Small monospace tag, like the portfolio's tech/status chips. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] leading-none",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const BAR: Record<Tone, string> = {
  neutral: "bg-fg-3",
  info: "bg-linear-to-r from-accent-strong via-accent to-violet shadow-[0_0_12px_var(--glow-strong)]",
  success: "bg-ok shadow-[0_0_10px_color-mix(in_srgb,var(--ok)_45%,transparent)]",
  warning: "bg-warn",
  danger: "bg-err",
};

export function ProgressBar({
  value,
  max = 1,
  tone = "info",
  label,
  size = "md",
}: {
  value: number;
  max?: number;
  tone?: Tone;
  label: string;
  size?: "sm" | "md";
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(pct)}
      className={cx("w-full overflow-hidden rounded-full bg-line-muted", size === "sm" ? "h-1" : "h-1.5")}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none", BAR[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export const inputClass =
  "block h-9 w-full rounded-md border border-line-muted bg-sunken px-3 text-sm text-fg placeholder:text-fg-3 transition " +
  "focus:outline-none data-focus:border-accent data-focus:shadow-glow data-hover:border-line";

export const fieldLabelClass = "label-mono mb-1.5 block text-[10px]";
