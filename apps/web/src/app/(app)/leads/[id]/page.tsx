"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import clsx from "clsx";
import {
  CalendarClock,
  Mail,
  MessageCircle,
  Phone,
  StickyNote,
} from "lucide-react";
import type {
  LeadDetailData,
  LeadLossReason,
  PipelineStageSummary,
  PlaceCallResult,
  PurchaseIntent,
} from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, Dialog, ErrorState, Input, Select, Spinner, useToast } from "@/components/ui";
import { DispositionDialog, FollowUpDialog } from "@/components/lead-dialogs";
import {
  ACTIVITY_LABEL,
  DISPOSITION_LABEL,
  LOSS_REASON_LABEL,
  PriorityBadge,
  ScoreBadge,
  StageStrip,
  formatAmount,
  formatDuration,
  formatWhen,
} from "@/components/crm";

const LOSS_REASONS: LeadLossReason[] = [
  "NOT_INTERESTED",
  "NO_BUDGET",
  "WRONG_NUMBER",
  "DUPLICATE",
  "COMPETITOR",
  "NOT_NOW",
  "LOST",
];

/**
 * The single screen a telecaller works from: who this is, how to reach
 * them, where they are in the pipeline, what we know, what happened, and
 * the one action that should come next. Everything routine happens here —
 * no navigating away to log a call, qualify, or book a follow-up.
 */
export default function LeadWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [lossFor, setLossFor] = useState<PipelineStageSummary | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading, error } = useQuery<LeadDetailData>({
    queryKey: ["leads", id, "detail"],
    queryFn: () => api.get<LeadDetailData>(`/api/v1/leads/${id}/detail`),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  const startCall = useMutation({
    mutationFn: () => api.post<PlaceCallResult>(`/api/v1/leads/${id}/calls`),
    onSuccess: (result) => {
      // A manual provider hands back a tel: URI for the device to dial; a
      // bridged provider would have placed the call itself.
      if (result.dialUri) window.location.href = result.dialUri;
      setDispositionOpen(true);
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not start the call", "error"),
  });

  const changeStage = useMutation({
    mutationFn: (input: { stageId: string; lossReason?: LeadLossReason; lossNotes?: string }) =>
      api.patch(`/api/v1/leads/${id}/stage`, input),
    onSuccess: () => {
      setLossFor(null);
      invalidate();
      toast.push("Stage updated", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not change the stage", "error"),
  });

  const addNote = useMutation({
    mutationFn: () => api.post(`/api/v1/leads/${id}/notes`, { body: note }),
    onSuccess: () => {
      setNote("");
      invalidate();
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not save the note", "error"),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load this lead." />;

  const { lead } = data;
  const nextFollowUp = data.followUps.find((f) => f.status === "PENDING");
  const when = formatWhen(nextFollowUp?.dueAt);
  const closed = lead.status === "CONVERTED";

  return (
    <div className="flex flex-col gap-5">
      <Link href="/leads" className="text-xs text-muted hover:text-ink">
        ← Back to leads
      </Link>

      {/* Header: identity, reachability, and the actions that use them. */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-ink">{lead.fullName}</h1>
              <ScoreBadge score={lead.score} band={data.scoreBand} />
              <PriorityBadge priority={lead.priority} />
              <Badge tone={lead.status === "CONVERTED" ? "success" : "neutral"}>{lead.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">
              {[lead.jobTitle, lead.company].filter(Boolean).join(" · ") || "No company on file"}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {lead.phone && <span>{lead.phone}</span>}
              {lead.email && <span>{lead.email}</span>}
              {lead.website && (
                <a
                  href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-emerald underline"
                >
                  {lead.website}
                </a>
              )}
            </div>
            {lead.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lead.tags.map((tag) => (
                  <Badge key={tag} tone="info">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => startCall.mutate()} disabled={!lead.phone || startCall.isPending}>
              <Phone size={15} aria-hidden /> Call
            </Button>
            <a
              href={lead.phone ? `https://wa.me/${lead.phone.replace(/\D/g, "")}` : undefined}
              target="_blank"
              rel="noreferrer noopener"
              aria-disabled={!lead.phone}
              className={clsx(!lead.phone && "pointer-events-none opacity-50")}
            >
              <Button variant="secondary" disabled={!lead.phone}>
                <MessageCircle size={15} aria-hidden /> WhatsApp
              </Button>
            </a>
            <a href={lead.email ? `mailto:${lead.email}` : undefined} className={clsx(!lead.email && "pointer-events-none opacity-50")}>
              <Button variant="secondary" disabled={!lead.email}>
                <Mail size={15} aria-hidden /> Email
              </Button>
            </a>
            <Button variant="secondary" onClick={() => setDispositionOpen(true)} disabled={!lead.phone}>
              Log outcome
            </Button>
          </div>
        </div>
      </Card>

      {/* The next action, given its own prominence — it is the whole job. */}
      <Card className="border-emerald/40 bg-emerald/5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CalendarClock size={20} className="text-emerald-dark" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">Next action</p>
              <p className={clsx("text-sm", when.overdue ? "font-medium text-coral" : "text-muted")}>
                {nextFollowUp
                  ? `${when.overdue ? "Overdue · " : ""}${when.label}${nextFollowUp.note ? ` — ${nextFollowUp.note}` : ""}`
                  : "Nothing scheduled yet"}
              </p>
            </div>
          </div>
          <Button onClick={() => setFollowUpOpen(true)}>
            {nextFollowUp ? "Schedule another follow-up" : "Schedule follow-up"}
          </Button>
        </div>
      </Card>

      {/* Pipeline stage strip. */}
      <Card>
        <h2 className="mb-3 text-sm font-medium text-ink">Pipeline stage</h2>
        <StageStrip
          stages={data.stages}
          currentStageId={lead.stageId}
          disabled={closed || changeStage.isPending}
          onSelect={(stage) => {
            if (stage.isLost) setLossFor(stage);
            else changeStage.mutate({ stageId: stage.id });
          }}
        />
        {closed && (
          <p className="mt-2 text-xs text-muted">
            This lead has been converted — it is now managed on the{" "}
            <Link href="/pipeline" className="text-emerald underline">
              deal pipeline
            </Link>
            .
          </p>
        )}
        {lead.lossReason && (
          <p className="mt-2 text-xs text-coral">
            Lost: {LOSS_REASON_LABEL[lead.lossReason]}
            {lead.lossNotes ? ` — ${lead.lossNotes}` : ""}
          </p>
        )}
      </Card>

      {Object.keys(lead.customFields ?? {}).length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-medium text-ink">Imported data</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {Object.entries(lead.customFields).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="truncate text-xs text-muted">{key.replace(/_/g, " ")}</dt>
                <dd className="truncate text-ink" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <QualificationPanel data={data} onSaved={invalidate} />

        <Card>
          <h2 className="mb-3 text-sm font-medium text-ink">Activity</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) addNote.mutate();
            }}
            className="mb-4 flex gap-2"
          >
            <Input
              placeholder="Add a note…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="Add a note to the timeline"
            />
            <Button type="submit" variant="secondary" disabled={!note.trim() || addNote.isPending}>
              <StickyNote size={15} aria-hidden /> Add
            </Button>
          </form>

          {data.activities.length === 0 ? (
            <p className="text-sm text-muted">Nothing has happened on this lead yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {data.activities.map((entry) => {
                const duration = formatDuration(entry.callDurationSeconds);
                return (
                  <li key={entry.id} className="border-l-2 border-border pl-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-ink">{ACTIVITY_LABEL[entry.type]}</span>
                      {entry.callDisposition && (
                        <Badge tone={entry.callOutcome === "CONNECTED" ? "success" : "neutral"}>
                          {DISPOSITION_LABEL[entry.callDisposition]}
                        </Badge>
                      )}
                      {duration && <span className="text-xs text-muted">{duration}</span>}
                      <span className="ml-auto text-xs text-muted">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {entry.body && <p className="mt-0.5 text-sm text-muted">{entry.body}</p>}
                    <p className="mt-0.5 text-xs text-muted">{entry.actor.fullName}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      {dispositionOpen && (
        <DispositionDialog leadId={id} onClose={() => setDispositionOpen(false)} onDone={invalidate} />
      )}

      {followUpOpen && (
        <FollowUpDialog leadId={id} onClose={() => setFollowUpOpen(false)} onDone={invalidate} />
      )}

      {lossFor && (
        <LossDialog
          stage={lossFor}
          submitting={changeStage.isPending}
          onClose={() => setLossFor(null)}
          onSubmit={(lossReason, lossNotes) => changeStage.mutate({ stageId: lossFor.id, lossReason, lossNotes })}
        />
      )}
    </div>
  );
}

const PURCHASE_INTENTS: PurchaseIntent[] = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function QualificationPanel({ data, onSaved }: { data: LeadDetailData; onSaved: () => void }) {
  const toast = useToast();
  const { lead } = data;
  const [form, setForm] = useState({
    budget: lead.budgetMinor ? String(lead.budgetMinor / 100) : "",
    timelineDays: lead.timelineDays !== null ? String(lead.timelineDays) : "",
    isDecisionMaker: lead.isDecisionMaker ?? false,
    requirement: lead.requirement ?? "",
    requirementUrgent: lead.requirementUrgent ?? false,
    businessType: lead.businessType ?? "",
    existingSolution: lead.existingSolution ?? "",
    purchaseIntent: (lead.purchaseIntent ?? "UNKNOWN") as PurchaseIntent,
    goodBusinessFit: lead.goodBusinessFit ?? false,
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch<{ score: number; band: string }>(`/api/v1/leads/${lead.id}/qualification`, {
        budgetMinor: form.budget ? Math.round(parseFloat(form.budget) * 100) : undefined,
        timelineDays: form.timelineDays ? Number(form.timelineDays) : undefined,
        isDecisionMaker: form.isDecisionMaker,
        requirement: form.requirement || undefined,
        requirementUrgent: form.requirementUrgent,
        businessType: form.businessType || undefined,
        existingSolution: form.existingSolution || undefined,
        purchaseIntent: form.purchaseIntent,
        goodBusinessFit: form.goodBusinessFit,
      }),
    onSuccess: (result) => {
      onSaved();
      toast.push(`Saved — score ${result.score} (${result.band})`, "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not save", "error"),
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Qualification</h2>
        <ScoreBadge score={lead.score} band={data.scoreBand} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <label className="flex flex-col gap-1 text-xs text-muted">
          Budget (₹)
          <Input type="number" min="0" step="0.01" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Timeline (days)
          <Input type="number" min="0" value={form.timelineDays} onChange={(e) => setForm({ ...form, timelineDays: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
          Requirement
          <Input value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Business type
          <Input value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Existing solution
          <Input value={form.existingSolution} onChange={(e) => setForm({ ...form, existingSolution: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Purchase intent
          <Select value={form.purchaseIntent} onChange={(e) => setForm({ ...form, purchaseIntent: e.target.value as PurchaseIntent })}>
            {PURCHASE_INTENTS.map((intent) => (
              <option key={intent} value={intent}>
                {intent}
              </option>
            ))}
          </Select>
        </label>

        <fieldset className="flex flex-col gap-2 text-sm text-ink">
          <legend className="mb-1 text-xs text-muted">Signals</legend>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.isDecisionMaker}
              onChange={(e) => setForm({ ...form, isDecisionMaker: e.target.checked })}
            />
            Decision maker
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.requirementUrgent}
              onChange={(e) => setForm({ ...form, requirementUrgent: e.target.checked })}
            />
            Urgent requirement
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.goodBusinessFit}
              onChange={(e) => setForm({ ...form, goodBusinessFit: e.target.checked })}
            />
            Good business fit
          </label>
        </fieldset>

        <div className="sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save qualification"}
          </Button>
        </div>
      </form>

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">How this score is made up</p>
        <ul className="flex flex-col gap-1 text-xs">
          {data.scoreBreakdown.map((entry) => (
            <li key={entry.key} className={clsx("flex justify-between", entry.earned ? "text-ink" : "text-muted")}>
              <span>
                {entry.earned ? "✓" : "○"} {entry.label}
              </span>
              <span>
                {entry.earned ? "+" : ""}
                {entry.earned ? entry.weight : 0} / {entry.weight}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {lead.budgetMinor ? (
        <p className="mt-3 text-xs text-muted">Qualified budget: {formatAmount(lead.budgetMinor)}</p>
      ) : null}
    </Card>
  );
}

function LossDialog({
  stage,
  onClose,
  onSubmit,
  submitting,
}: {
  stage: PipelineStageSummary;
  onClose: () => void;
  onSubmit: (reason: LeadLossReason, notes?: string) => void;
  submitting: boolean;
}) {
  const [reason, setReason] = useState<LeadLossReason>("NOT_INTERESTED");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open onClose={onClose} title={`Move to ${stage.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason, notes || undefined);
        }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1 text-sm text-ink">
          Loss reason
          <Select value={reason} onChange={(e) => setReason(e.target.value as LeadLossReason)}>
            {LOSS_REASONS.map((option) => (
              <option key={option} value={option}>
                {LOSS_REASON_LABEL[option]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Notes (optional)
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <Button type="submit" variant="danger" disabled={submitting}>
            {submitting ? "Saving…" : "Confirm"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
