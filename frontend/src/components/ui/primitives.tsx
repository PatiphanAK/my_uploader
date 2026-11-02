"use client";

import { Button as HButton, type ButtonProps as HButtonProps } from "@headlessui/react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-card data-hover:bg-accent-strong",
  secondary: "border border-line bg-elevated text-fg shadow-card data-hover:bg-sunken",
  ghost: "text-fg-2 data-hover:bg-sunken data-hover:text-fg",
  danger: "text-err data-hover:bg-err/8",
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
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition",
        "focus:outline-none data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent",
        "data-disabled:cursor-not-allowed data-disabled:opacity-45 data-disabled:shadow-none",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} />}
      {children}
    </HButton>
  );
}

/** White card with an optional numbered step heading. */
export function Panel({
  id,
  index,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  index?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cx("scroll-mt-20 rounded-2xl border border-line bg-elevated p-5 shadow-card sm:p-6", className)}
    >
      {(title || actions) && (
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {index && (
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {index}
              </span>
            )}
            <div>
              {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-fg-3">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-fg-2",
  info: "bg-accent-soft text-accent",
  success: "bg-ok/10 text-ok",
  warning: "bg-warn/10 text-warn",
  danger: "bg-err/10 text-err",
};

/** Small pill label. */
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-5 font-medium",
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
  info: "bg-linear-to-r from-accent to-violet",
  success: "bg-ok",
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
      className={cx("w-full overflow-hidden rounded-full bg-sunken", size === "sm" ? "h-1" : "h-2")}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none", BAR[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export const inputClass =
  "block h-10 w-full rounded-lg border border-line bg-elevated px-3 text-sm text-fg shadow-card placeholder:text-fg-3 transition " +
  "focus:outline-none data-focus:border-accent data-focus:shadow-focus data-hover:border-zinc-300";

export const fieldLabelClass = "mb-1.5 block text-sm font-medium text-fg";
