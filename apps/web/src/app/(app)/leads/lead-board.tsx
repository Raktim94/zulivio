"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import type {
  LeadLossReason,
  LeadRecord,
  LeadScoreConfigSummary,
  LeadSearchResult,
  PipelineStageSummary,
} from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Button, Dialog, ErrorState, Input, Select, Spinner, useToast } from "@/components/ui";
import { LeadCard, LOSS_REASON_LABEL, formatAmount } from "@/components/crm";

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
 * What a stage needs before a lead may land on it. Mirrors the server's
 * rule (probability >= 50 means "qualified") so the modal asks for exactly
 * what the API would otherwise reject — the server stays the authority,
 * this just avoids a pointless round trip and a confusing error toast.
 */
function missingFieldsFor(stage: PipelineStageSummary, lead: LeadRecord): ("budget" | "timeline" | "requirement")[] {
  if (stage.isLost || stage.probability < 50) return [];
  const missing: ("budget" | "timeline" | "requirement")[] = [];
  if (!lead.budgetMinor) missing.push("budget");
  if (lead.timelineDays === null) missing.push("timeline");
  if (!lead.requirement?.trim()) missing.push("requirement");
  return missing;
}

interface PendingMove {
  lead: LeadRecord;
  stage: PipelineStageSummary;
  missing: ("budget" | "timeline" | "requirement")[];
}

export function LeadBoard({
  stages,
  scoreConfig,
  canBulkAct,
}: {
  stages: PipelineStageSummary[];
  scoreConfig?: LeadScoreConfigSummary;
  canBulkAct: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [ownerFilter, setOwnerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  // The board loads every open lead in one page — pageSize is capped at 100
  // server-side, which is the point at which a Kanban stops being readable
  // anyway; the List tab is the tool for larger sets.
  const params = new URLSearchParams({ pageSize: "100", sort: "score" });
  if (ownerFilter) params.set("ownerId", ownerFilter);
  if (search.trim()) params.set("q", search.trim());

  const { data, isLoading, error } = useQuery<LeadSearchResult>({
    queryKey: ["leads", "board", ownerFilter, search],
    queryFn: () => api.get<LeadSearchResult>(`/api/v1/leads/search?${params.toString()}`),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
  }

  const moveStage = useMutation({
    mutationFn: (input: {
      leadId: string;
      stageId: string;
      lossReason?: LeadLossReason;
      lossNotes?: string;
      qualification?: Record<string, unknown>;
    }) =>
      api.patch(`/api/v1/leads/${input.leadId}/stage`, {
        stageId: input.stageId,
        lossReason: input.lossReason,
        lossNotes: input.lossNotes,
        qualification: input.qualification,
      }),
    onSuccess: () => {
      setPending(null);
      invalidate();
      toast.push("Lead moved", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not move the lead", "error"),
  });

  const leadsByStage = useMemo(() => {
    const map = new Map<string, LeadRecord[]>();
    for (const stage of stages) map.set(stage.id, []);
    for (const lead of data?.items ?? []) {
      if (!lead.stageId) continue;
      map.get(lead.stageId)?.push(lead);
    }
    return map;
  }, [data, stages]);

  function attemptMove(lead: LeadRecord, stage: PipelineStageSummary) {
    if (lead.stageId === stage.id) return;
    const missing = missingFieldsFor(stage, lead);
    // A loss stage always needs a reason, and a qualifying stage needs its
    // answers — both are a small contextual modal, never a full form.
    if (missing.length > 0 || stage.isLost) {
      setPending({ lead, stage, missing });
      return;
    }
    moveStage.mutate({ leadId: lead.id, stageId: stage.id });
  }

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState message="Could not load the lead board." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-full max-w-xs"
          placeholder="Search name, phone, company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search leads on the board"
        />
        <OwnerFilter value={ownerFilter} onChange={setOwnerFilter} enabled={canBulkAct} />
        <p className="ml-auto text-xs text-muted">
          {data?.total ?? 0} leads
          {(data?.total ?? 0) > (data?.items.length ?? 0) &&
            ` · showing the first ${data?.items.length} — use the List tab for the rest`}
        </p>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: `${stages.length * 240}px` }}>
          {stages.map((stage) => {
            const cards = leadsByStage.get(stage.id) ?? [];
            const stageValue = cards.reduce((sum, l) => sum + (l.budgetMinor ?? 0), 0);

            return (
              <section
                key={stage.id}
                aria-label={`${stage.name} — ${cards.length} leads`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverStageId(stage.id);
                }}
                onDragLeave={() => setDragOverStageId((current) => (current === stage.id ? null : current))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverStageId(null);
                  const leadId = e.dataTransfer.getData("text/plain");
                  const lead = data?.items.find((l) => l.id === leadId);
                  if (lead) attemptMove(lead, stage);
                }}
                className={clsx(
                  "flex w-56 shrink-0 flex-col gap-2 rounded-xl p-1 transition",
                  dragOverStageId === stage.id && "bg-emerald/5 ring-2 ring-emerald/40",
                )}
              >
                <header className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 shadow-sm">
                  <span className="truncate text-sm font-medium text-ink">{stage.name}</span>
                  <span className="text-xs text-muted">{cards.length}</span>
                </header>
                {stageValue > 0 && <p className="px-1 text-xs text-muted">{formatAmount(stageValue)}</p>}

                {cards.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    hotThreshold={scoreConfig?.hotThreshold}
                    warmThreshold={scoreConfig?.warmThreshold}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
                  />
                ))}

                {cards.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted">
                    Drop a lead here
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted">
        Drag a card between columns, or open a lead and use its stage strip — the strip is fully keyboard
        accessible.
      </p>

      {pending && (
        <StageMoveDialog
          pending={pending}
          onClose={() => setPending(null)}
          submitting={moveStage.isPending}
          onSubmit={(payload) =>
            moveStage.mutate({
              leadId: pending.lead.id,
              stageId: pending.stage.id,
              ...payload,
            })
          }
        />
      )}
    </div>
  );
}

/** The contextual modal — asks only for what this specific move is missing. */
function StageMoveDialog({
  pending,
  onClose,
  onSubmit,
  submitting,
}: {
  pending: PendingMove;
  onClose: () => void;
  onSubmit: (payload: {
    lossReason?: LeadLossReason;
    lossNotes?: string;
    qualification?: Record<string, unknown>;
  }) => void;
  submitting: boolean;
}) {
  const [budget, setBudget] = useState("");
  const [timelineDays, setTimelineDays] = useState("");
  const [requirement, setRequirement] = useState(pending.lead.requirement ?? "");
  const [lossReason, setLossReason] = useState<LeadLossReason>("NOT_INTERESTED");
  const [lossNotes, setLossNotes] = useState("");

  const isLoss = pending.stage.isLost;

  return (
    <Dialog open onClose={onClose} title={`Move to ${pending.stage.name}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isLoss) {
            onSubmit({ lossReason, lossNotes: lossNotes || undefined });
            return;
          }
          const qualification: Record<string, unknown> = {};
          if (pending.missing.includes("budget")) {
            qualification.budgetMinor = Math.round(parseFloat(budget || "0") * 100);
          }
          if (pending.missing.includes("timeline")) qualification.timelineDays = Number(timelineDays);
          if (pending.missing.includes("requirement")) qualification.requirement = requirement;
          onSubmit({ qualification });
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-sm text-muted">
          {isLoss
            ? `Why was ${pending.lead.fullName} lost?`
            : `${pending.stage.name} needs a little more from this conversation first.`}
        </p>

        {isLoss ? (
          <>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Loss reason
              <Select value={lossReason} onChange={(e) => setLossReason(e.target.value as LeadLossReason)}>
                {LOSS_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {LOSS_REASON_LABEL[reason]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Notes (optional)
              <Input value={lossNotes} onChange={(e) => setLossNotes(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            {pending.missing.includes("budget") && (
              <label className="flex flex-col gap-1 text-sm text-ink">
                Budget (₹)
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
            )}
            {pending.missing.includes("timeline") && (
              <label className="flex flex-col gap-1 text-sm text-ink">
                Timeline (days until they decide)
                <Input
                  type="number"
                  min="0"
                  required
                  value={timelineDays}
                  onChange={(e) => setTimelineDays(e.target.value)}
                />
              </label>
            )}
            {pending.missing.includes("requirement") && (
              <label className="flex flex-col gap-1 text-sm text-ink">
                Requirement
                <Input
                  required
                  placeholder="What do they actually need?"
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                />
              </label>
            )}
          </>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Moving…" : `Move to ${pending.stage.name}`}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function OwnerFilter({
  value,
  onChange,
  enabled,
}: {
  value: string;
  onChange: (value: string) => void;
  enabled: boolean;
}) {
  const { data: employees } = useQuery<{ id: string; fullName: string; employeeNumber: string }[]>({
    queryKey: ["employees"],
    queryFn: () => api.get("/api/v1/employees"),
    enabled,
  });

  if (!enabled) return null;

  return (
    <Select
      className="w-52"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter the board by owner"
    >
      <option value="">All owners</option>
      {(employees ?? []).map((emp) => (
        <option key={emp.id} value={emp.id}>
          {emp.fullName}
        </option>
      ))}
    </Select>
  );
}
