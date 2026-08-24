"use client";

import clsx from "clsx";
import Link from "next/link";
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
import { Badge } from "./ui";

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

// ---------------------------------------------------------------------
// Lead card
// ---------------------------------------------------------------------

/**
 * The board card. Deliberately five lines at most — name, company,
 * value, owner, next follow-up — because a column of dense cards is
 * unreadable at a glance and the workspace is one click away for detail.
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

      <p className="mt-2 truncate text-xs text-muted">{lead.owner?.fullName ?? "Unassigned"}</p>

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
