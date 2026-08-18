"use client";

import clsx from "clsx";
import { createContext, useContext, useCallback, useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

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

/**
 * A native <input type="file"> renders inconsistently (sometimes nearly
 * invisible) across browsers/OS themes. This hides it behind a visually
 * hidden input triggered by a real styled Button, with the chosen filename
 * shown next to it, so the control is unambiguous.
 */
export function FileInput({
  value,
  onChange,
  accept,
  required,
  label = "Choose file",
}: {
  value: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  required?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        required={required}
        className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
      <span className={clsx("truncate text-sm", value ? "text-ink" : "text-muted")}>
        {value ? value.name : "No file chosen"}
      </span>
    </div>
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

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-border/60", className)} aria-hidden="true" />;
}

/**
 * Uses the native <dialog> element via showModal(), which gives us a
 * correct focus trap, Escape-to-close, and top-layer stacking for free —
 * this codebase has no Radix/headless-UI primitives, and hand-rolling
 * those behaviors in JS is exactly the class of a11y bug easiest to get
 * wrong. Closing on backdrop click is the one thing <dialog> doesn't do
 * automatically, so that's handled explicitly below.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Fires on Escape and on the browser's own dismiss affordances, so the
  // caller's `open` state always stays in sync with reality.
  const handleClose = useCallback(() => onClose(), [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={clsx(
        "w-[calc(100vw-2rem)] max-w-lg rounded-xl border border-border bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 id={titleId} className="text-sm font-semibold text-ink">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded-md p-1 text-muted transition hover:bg-canvas hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

/** Ordered [{ id, label }] tabs with roving-tabindex keyboard nav, per the WAI-ARIA tabs pattern. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (e.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") nextIndex = 0;
    if (e.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const next = tabs[nextIndex];
    onChange(next.id);
    refs.current[next.id]?.focus();
  }

  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab, i) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={clsx(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition",
              selected ? "border-emerald text-emerald-dark" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, active, children }: { id: string; active: string; children: ReactNode }) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className="pt-4">
      {children}
    </div>
  );
}

interface ToastMessage {
  id: string;
  text: string;
  tone: "success" | "error" | "info";
}

const ToastContext = createContext<{ push: (text: string, tone?: ToastMessage["tone"]) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const push = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const toneClass: Record<ToastMessage["tone"], string> = {
    success: "border-emerald/30 bg-emerald/10 text-emerald-dark",
    error: "border-coral/30 bg-coral/10 text-coral",
    info: "border-border bg-surface text-ink",
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg",
              toneClass[t.tone],
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

export function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass: Record<string, string> = {
    neutral: "text-ink",
    success: "text-emerald-dark",
    warning: "text-amber",
    danger: "text-coral",
    info: "text-indigo",
  };
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={clsx("mt-1.5 text-2xl font-semibold", toneClass[tone])}>{value}</p>
    </Card>
  );
}

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

/** Client-side sortable/paginated table. Sorting is delegated to the caller via onSort — this component only tracks/announces UI state. */
export function Table<T extends { id: string }>({
  columns,
  rows,
  page,
  pageSize,
  onPageChange,
  sortKey,
  sortDir,
  onSort,
  onRowClick,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  if (rows.length === 0) {
    return <EmptyState title="No results" description="Nothing matches the current filters." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-canvas/60">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined
                  }
                  className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted"
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-ink"
                    >
                      {col.header}
                      {sortKey === col.key && <span aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "button" : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
                className={clsx(
                  "border-b border-border last:border-0 hover:bg-canvas/40",
                  onRowClick && "cursor-pointer focus:bg-canvas/60 focus:outline-none",
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-2.5 text-ink">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm text-muted">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
              Previous
            </Button>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
