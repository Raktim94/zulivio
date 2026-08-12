"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(16,38,53,0.04),0_1px_1px_rgba(16,38,53,0.03)]",
        className,
      )}
      {...props}
    />
  );
}

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        variant === "primary" && "bg-emerald text-white shadow-sm shadow-emerald/20 hover:bg-emerald-dark",
        variant === "secondary" && "border border-border bg-surface text-ink hover:bg-canvas",
        variant === "danger" && "bg-coral text-white shadow-sm shadow-coral/20 hover:opacity-90",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-emerald focus:ring-1 focus:ring-emerald",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-emerald focus:ring-1 focus:ring-emerald",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-canvas text-muted",
    success: "bg-emerald/10 text-emerald-dark",
    warning: "bg-amber/10 text-amber",
    danger: "bg-coral/10 text-coral",
    info: "bg-indigo/10 text-indigo",
  };
  return (
    <span className={clsx("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-coral/30 bg-coral/5 px-4 py-3 text-sm text-coral">
      {message}
    </div>
  );
}

export function Spinner() {
  return (
    <div
      className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-emerald"
      role="status"
      aria-label="Loading"
    />
  );
}
