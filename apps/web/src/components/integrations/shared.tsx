"use client";

import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Button, Dialog } from "@/components/ui";

export interface Catalog {
  apiVersion: string;
  events: { type: string; description: string }[];
  scopes: { scope: string; description: string }[];
  telephony: { defaultFields: Record<string, string>; defaultStatusMap: Record<string, string> };
}

export function when(iso: string | null | undefined, empty = "never") {
  return iso ? new Date(iso).toLocaleString() : empty;
}

export { ConfirmDialog } from "@/components/ui";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="px-3 py-1.5 text-xs"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard unavailable: the value is still selectable on screen */
        }
      }}
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

/** Shows a newly created secret exactly once. It lives only in this component's props; closing it discards it. */
export function SecretOnceDialog({ secret, title, note, onClose }: { secret: string | null; title: string; note?: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open={secret !== null} onClose={onClose} title={title}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex gap-2 rounded-lg bg-amber/10 p-3 text-amber">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <p>Copy this now. It is shown only once and can't be recovered — if you lose it, rotate it to get a new one.</p>
        </div>
        <code className="block break-all rounded-lg border border-border bg-canvas p-3 text-xs text-ink select-all" data-testid="one-time-secret">
          {secret}
        </code>
        <div className="flex items-center justify-between gap-2">
          <CopyButton value={secret ?? ""} label="secret" />
          <Button onClick={onClose}>I've stored it safely</Button>
        </div>
        {note}
      </div>
    </Dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function statusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (status) {
    case "active":
    case "connected":
    case "success":
      return "success";
    case "paused":
    case "pending":
    case "waiting_for_events":
      return "warning";
    case "revoked":
    case "expired":
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  not_configured: "Not set up",
  paused: "Paused",
  waiting_for_events: "Waiting for first event",
  active: "Active",
  revoked: "Revoked",
  expired: "Expired",
  success: "Delivered",
  pending: "Retrying",
  failed: "Failed",
};
