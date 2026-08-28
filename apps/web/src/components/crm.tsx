"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { Phone, MessageCircle, Copy, StickyNote, Trash2 } from "lucide-react";
import type {
  CallDisposition,
  CallOutcome,
  LeadActivityType,
  LeadLossReason,
  LeadPriority,
  LeadRecord,
  LeadScoreBand,
  PipelineStageSummary,
} from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Dialog, Input, useToast } from "./ui";

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------

export function formatAmount(minor: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

/**
 * "Today · 5:30 PM" / "Tomorrow · 9:00 AM" / "Mon 3 Sep · 4:00 PM", plus an
 * explicit overdue marker. A telecaller scans this column dozens of times
 * an hour, so a bare ISO timestamp or a raw locale string would cost real
 * time on every read.
 */
export function formatWhen(iso: string | null | undefined): { label: string; overdue: boolean } {
  if (!iso) return { label: "—", overdue: false };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: "—", overdue: false };

  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let day: string;
  if (sameDay(date, now)) day = "Today";
  else if (sameDay(date, tomorrow)) day = "Tomorrow";
  else day = date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  return { label: `${day} · ${time}`, overdue: date.getTime() < now.getTime() };
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ---------------------------------------------------------------------
// Labels — human-readable text for every enum the API returns.
// ---------------------------------------------------------------------

export const DISPOSITION_LABEL: Record<CallDisposition, string> = {
  INTERESTED: "Interested",
  QUALIFIED: "Qualified",
  MEETING_BOOKED: "Meeting booked",
  CALLBACK: "Callback",
  PROPOSAL_REQUESTED: "Proposal requested",
  NOT_INTERESTED: "Not interested",
  NO_BUDGET: "No budget",
  COMPETITOR: "Competitor",
  WRONG_PERSON: "Wrong person",
  NO_ANSWER: "No answer",
  BUSY: "Busy",
  SWITCHED_OFF: "Switched off",
  INVALID_NUMBER: "Invalid number",
  OUT_OF_COVERAGE: "Out of coverage",
};

export const DISPOSITIONS_BY_OUTCOME: Record<CallOutcome, CallDisposition[]> = {
  CONNECTED: [
    "INTERESTED",
    "QUALIFIED",
    "MEETING_BOOKED",
    "CALLBACK",
    "PROPOSAL_REQUESTED",
    "NOT_INTERESTED",
    "NO_BUDGET",
    "COMPETITOR",
    "WRONG_PERSON",
  ],
  NOT_CONNECTED: ["NO_ANSWER", "BUSY", "SWITCHED_OFF", "INVALID_NUMBER", "OUT_OF_COVERAGE"],
};

export const LOSS_REASON_LABEL: Record<LeadLossReason, string> = {
  NOT_INTERESTED: "Not interested",
  NO_BUDGET: "No budget",
  WRONG_NUMBER: "Wrong number",
  DUPLICATE: "Duplicate",
  COMPETITOR: "Competitor",
  NOT_NOW: "Not now",
  LOST: "Lost",
};

export const PRIORITY_LABEL: Record<LeadPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

export const ACTIVITY_LABEL: Record<LeadActivityType, string> = {
  CALL: "Call",
  NOTE: "Note",
  MESSAGE: "Message",
  MEETING: "Meeting",
  STAGE_CHANGE: "Stage change",
  STATUS_CHANGE: "Status change",
  QUALIFICATION_UPDATED: "Qualification updated",
  ASSIGNMENT_CHANGED: "Reassigned",
  FOLLOW_UP_SCHEDULED: "Follow-up scheduled",
  FOLLOW_UP_COMPLETED: "Follow-up completed",
  FOLLOW_UP_RESCHEDULED: "Follow-up rescheduled",
};

// ---------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------

/**
 * HOT/WARM/COLD follows the convention every sales team already reads:
 * hot is the urgent red, warm the amber middle, cold a quiet neutral. The
 * numeric score is kept next to it because the band alone hides the
 * difference between an 80 and a 100.
 */
export function ScoreBadge({ score, band }: { score: number; band: LeadScoreBand }) {
  const tone = band === "HOT" ? "danger" : band === "WARM" ? "warning" : "neutral";
  return (
    <Badge tone={tone}>
      {band} · {score}
    </Badge>
  );
}

export function bandFor(score: number, hot = 80, warm = 50): LeadScoreBand {
  if (score >= hot) return "HOT";
  if (score >= warm) return "WARM";
  return "COLD";
}

export function PriorityBadge({ priority }: { priority: LeadPriority }) {
  if (priority === "NORMAL") return null;
  const tone = priority === "URGENT" ? "danger" : priority === "HIGH" ? "warning" : "neutral";
  return <Badge tone={tone}>{PRIORITY_LABEL[priority]}</Badge>;
}

/** "phone_local_10d" -> "Phone local 10d" — humanizes an import-derived custom-field key for display. */
function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/_/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const MAX_VISIBLE_CUSTOM_FIELDS = 4;

/** Compact chips for whatever extra columns a CSV import brought in — a card stays readable for any lead shape. */
function CustomFieldChips({ customFields }: { customFields: Record<string, string> | null | undefined }) {
  const entries = Object.entries(customFields ?? {}).filter(([, value]) => value?.trim());
  if (entries.length === 0) return null;

  const visible = entries.slice(0, MAX_VISIBLE_CUSTOM_FIELDS);
  const hiddenCount = entries.length - visible.length;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {visible.map(([key, value]) => (
        <span
          key={key}
          title={`${humanizeFieldKey(key)}: ${value}`}
          className="max-w-[9rem] truncate rounded-full bg-canvas px-2 py-0.5 text-[10px] text-muted"
        >
          {humanizeFieldKey(key)}: {value}
        </span>
      ))}
      {hiddenCount > 0 && (
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] text-muted">+{hiddenCount} more</span>
      )}
    </div>
  );
}

/**
 * One-tap reach-out — call, WhatsApp, copy — right on the card, so a
 * telecaller working the board never has to open a lead just to dial it.
 * Plain tel:/wa.me links (not the logged-call flow the detail page uses),
 * matching how the WhatsApp button already behaves there.
 */
function QuickActions({ phone }: { phone: string }) {
  const toast = useToast();
  const digits = phone.replace(/\D/g, "");

  return (
    <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <a
        href={`tel:${phone}`}
        aria-label={`Call ${phone}`}
        title="Call"
        className="flex h-7 w-7 items-center justify-center rounded-md text-emerald-dark transition hover:bg-emerald/10"
      >
        <Phone size={14} aria-hidden />
      </a>
      <a
        href={`https://wa.me/${digits}`}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={`WhatsApp ${phone}`}
        title="WhatsApp"
        className="flex h-7 w-7 items-center justify-center rounded-md text-emerald-dark transition hover:bg-emerald/10"
      >
        <MessageCircle size={14} aria-hidden />
      </a>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(phone);
            toast.push("Phone number copied", "success");
          } catch {
            toast.push("Could not copy — your browser blocked clipboard access", "error");
          }
        }}
        aria-label={`Copy ${phone}`}
        title="Copy number"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink"
      >
        <Copy size={14} aria-hidden />
      </button>
      <span className="truncate text-xs text-muted">{phone}</span>
    </div>
  );
}

/**
 * A quick note a caller can leave on a lead right from the board, without
 * opening the full workspace — the same `/notes` endpoint the lead
 * workspace's Activity panel posts to, so it lands on the same timeline.
 */
function NoteButton({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();

  const addNote = useMutation({
    mutationFn: () => api.post(`/api/v1/leads/${leadId}/notes`, { body: note }),
    onSuccess: () => {
      setNote("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.push("Note added", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not save the note", "error"),
  });

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add a note to this lead"
        title="Add a note"
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted transition hover:bg-canvas hover:text-ink"
      >
        <StickyNote size={13} aria-hidden />
        Note
      </button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title="Add a note">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) addNote.mutate();
            }}
            className="flex flex-col gap-3"
          >
            <Input
              placeholder="What happened on this call?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Note"
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={!note.trim() || addNote.isPending}>
                {addNote.isPending ? "Saving…" : "Save note"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function DeleteButton({ leadId, leadName }: { leadId: string; leadName: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const deleteLead = useMutation({
    mutationFn: () => api.delete(`/api/v1/leads/${leadId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.push("Lead deleted", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not delete this lead", "error"),
  });

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (confirm(`Delete ${leadName}? This can't be undone.`)) deleteLead.mutate();
      }}
      disabled={deleteLead.isPending}
      aria-label={`Delete ${leadName}`}
      title="Delete lead"
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted transition hover:bg-coral/10 hover:text-coral"
    >
      <Trash2 size={13} aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------------
// Lead card
// ---------------------------------------------------------------------

/**
 * The board card. Name/company/value/badges/owner/follow-up stay a tight
 * five lines; phone (with one-tap call/WhatsApp/copy) and any import-derived
 * custom fields are shown too since a telecaller needs to act on a lead
 * without leaving the board — the full workspace is still one click away.
 */
export function LeadCard({
  lead,
  hotThreshold,
  warmThreshold,
  draggable,
  onDragStart,
  selected,
  onToggleSelect,
}: {
  lead: LeadRecord;
  hotThreshold?: number;
  warmThreshold?: number;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const followUp = formatWhen(lead.nextFollowUpAt);
  const band = bandFor(lead.score, hotThreshold, warmThreshold);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      className={clsx(
        "rounded-xl border bg-surface p-3 shadow-[0_1px_2px_rgba(16,38,53,0.04)] transition",
        selected ? "border-emerald ring-1 ring-emerald" : "border-border",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/leads/${lead.id}`}
            className="block truncate text-sm font-medium text-ink hover:text-emerald-dark hover:underline"
          >
            {lead.fullName}
          </Link>
          {lead.company && <p className="truncate text-xs text-muted">{lead.company}</p>}
          {lead.phone && <QuickActions phone={lead.phone} />}
        </div>
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={onToggleSelect}
            aria-label={`Select ${lead.fullName}`}
            className="mt-0.5 shrink-0"
          />
        )}
      </div>

      {lead.budgetMinor ? (
        <p className="mt-1.5 text-sm font-semibold text-emerald-dark">{formatAmount(lead.budgetMinor)}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ScoreBadge score={lead.score} band={band} />
        <PriorityBadge priority={lead.priority} />
        {lead.source && <Badge tone="info">{lead.source}</Badge>}
      </div>

      <CustomFieldChips customFields={lead.customFields} />

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted">{lead.owner?.fullName ?? "Unassigned"}</p>
        <div className="flex items-center">
          <NoteButton leadId={lead.id} />
          <DeleteButton leadId={lead.id} leadName={lead.fullName} />
        </div>
      </div>

      {lead.nextFollowUpAt && (
        <p className={clsx("mt-1 text-xs font-medium", followUp.overdue ? "text-coral" : "text-muted")}>
          {followUp.overdue ? "Overdue · " : ""}
          {followUp.label}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Pipeline stage strip
// ---------------------------------------------------------------------

/**
 * The horizontal stage strip on the lead workspace. Rendered as real
 * buttons in an ordered list, so the whole progression is keyboard
 * reachable and announced — the drag-and-drop board is a convenience on
 * top of this, never the only way to move a lead.
 */
export function StageStrip({
  stages,
  currentStageId,
  onSelect,
  disabled,
}: {
  stages: PipelineStageSummary[];
  currentStageId: string | null;
  onSelect: (stage: PipelineStageSummary) => void;
  disabled?: boolean;
}) {
  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Pipeline stage">
      {stages.map((stage, index) => {
        const isCurrent = stage.id === currentStageId;
        const isPast = currentIndex >= 0 && index < currentIndex && !stage.isLost;
        return (
          <li key={stage.id}>
            <button
              type="button"
              disabled={disabled || isCurrent}
              onClick={() => onSelect(stage)}
              aria-current={isCurrent ? "step" : undefined}
              className={clsx(
                "rounded-full px-3 py-1.5 text-xs font-medium transition disabled:cursor-default",
                isCurrent && stage.isLost && "bg-coral text-white",
                isCurrent && !stage.isLost && "bg-emerald text-white",
                !isCurrent && isPast && "bg-emerald/10 text-emerald-dark",
                !isCurrent && !isPast && "border border-border bg-surface text-muted hover:text-ink",
                disabled && !isCurrent && "opacity-50",
              )}
            >
              {stage.name}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
