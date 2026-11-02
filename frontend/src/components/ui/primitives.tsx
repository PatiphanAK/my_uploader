"use client";

import { Button as HButton, type ButtonProps as HButtonProps } from "@headlessui/react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary data-hover:bg-primary-hover",
  secondary: "border border-line-strong bg-base text-fg data-hover:bg-sunken",
  ghost: "text-fg-2 data-hover:bg-sunken data-hover:text-fg",
  danger: "text-err data-hover:bg-sunken",
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
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors",
        "focus:outline-none data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent",
        "data-disabled:cursor-not-allowed data-disabled:opacity-40",
        size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3.5 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} />}
      {children}
    </HButton>
  );
}

/** Section with a plain heading and a hairline border. */
export function Panel({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cx("rounded-lg border border-line bg-base", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-fg-3">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Text colour for a status tone. Status is shown as text, not as tags. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-fg-3",
  info: "text-accent",
  success: "text-ok",
  warning: "text-warn",
  danger: "text-err",
};

const BAR: Record<Tone, string> = {
  neutral: "bg-fg-3",
  info: "bg-accent",
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
      className={cx("w-full overflow-hidden bg-line", size === "sm" ? "h-0.5" : "h-1")}
    >
      <div
        className={cx("h-full transition-[width] duration-200 ease-out motion-reduce:transition-none", BAR[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export const inputClass =
  "block h-9 w-full rounded-md border border-line-strong bg-base px-3 text-sm text-fg placeholder:text-fg-3 transition-colors " +
  "focus:outline-none data-focus:border-accent data-focus:ring-1 data-focus:ring-accent";

export const fieldLabelClass = "mb-1.5 block text-xs font-medium text-fg-2";
