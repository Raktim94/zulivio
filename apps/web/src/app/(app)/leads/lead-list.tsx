"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type {
  EmployeeSummary,
  LeadLossReason,
  LeadPriority,
  LeadScoreConfigSummary,
  LeadSearchResult,
  LeadStatus,
  PipelineStageSummary,
} from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Select, Spinner, useToast } from "@/components/ui";
import { LOSS_REASON_LABEL, PriorityBadge, ScoreBadge, bandFor, formatWhen } from "@/components/crm";

const LOSS_REASONS: LeadLossReason[] = [
  "NOT_INTERESTED",
  "NO_BUDGET",
  "WRONG_NUMBER",
  "DUPLICATE",
  "COMPETITOR",
  "NOT_NOW",
  "LOST",
];

const STATUS_TONE: Record<LeadStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  NEW: "info",
  CONTACTED: "warning",
  QUALIFIED: "success",
  DISQUALIFIED: "neutral",
  CONVERTED: "success",
};

const PRIORITIES: LeadPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

interface Filters {
  q: string;
  status: string;
  stageId: string;
  ownerId: string;
  source: string;
  priority: string;
  minScore: string;
  followUpTo: string;
  createdFrom: string;
  unassigned: boolean;
  overdue: boolean;
  sort: string;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  status: "",
  stageId: "",
  ownerId: "",
  source: "",
  priority: "",
  minScore: "",
  followUpTo: "",
  createdFrom: "",
  unassigned: false,
  overdue: false,
  sort: "newest",
};

/**
 * Server-side filtered, sorted and paginated list — the counterpart to the
 * board for working sets larger than a Kanban can show. Every filter maps
 * to a query parameter on GET /api/v1/leads/search; nothing is filtered in
 * the browser, so page 3 of a 4,000-lead org is one small response.
 */
export function LeadList({
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

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkStageId, setBulkStageId] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [bulkLossReason, setBulkLossReason] = useState<LeadLossReason>("NOT_INTERESTED");

  const params = new URLSearchParams({ page: String(page), pageSize: "25", sort: filters.sort });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.stageId) params.set("stageId", filters.stageId);
  if (filters.ownerId) params.set("ownerId", filters.ownerId);
  if (filters.source.trim()) params.set("source", filters.source.trim());
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.minScore) params.set("minScore", filters.minScore);
  if (filters.followUpTo) params.set("followUpTo", new Date(filters.followUpTo).toISOString());
  if (filters.createdFrom) params.set("createdFrom", new Date(filters.createdFrom).toISOString());
  if (filters.unassigned) params.set("unassigned", "true");
  if (filters.overdue) params.set("overdue", "true");

  const { data, isLoading, error } = useQuery<LeadSearchResult>({
    queryKey: ["leads", "search", params.toString()],
    queryFn: () => api.get<LeadSearchResult>(`/api/v1/leads/search?${params.toString()}`),
  });

  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
    enabled: canBulkAct,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["reports"] });
    setSelected(new Set());
  }

  const bulk = useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) =>
      api.post<{ assigned?: number; moved?: number; tagged?: number; deleted?: number; skipped?: { reason: string }[] }>(
        `/api/v1/leads/bulk/${path}`,
        { leadIds: [...selected], ...body },
      ),
    onSuccess: (result) => {
      const count = result.assigned ?? result.moved ?? result.tagged ?? result.deleted ?? 0;
      const skipped = result.skipped?.length ?? 0;
      const verb = result.deleted !== undefined ? "deleted" : "updated";
      toast.push(`${count} lead${count === 1 ? "" : "s"} ${verb}${skipped ? `, ${skipped} skipped` : ""}`, "success");
      invalidate();
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Bulk action failed", "error"),
  });

  const selectedStage = stages.find((s) => s.id === bulkStageId);

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rows = data?.items ?? [];
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Input
            placeholder="Search name, phone, email, company, ID…"
            value={filters.q}
            onChange={(e) => update("q", e.target.value)}
            aria-label="Search leads"
            className="md:col-span-2"
          />
          <Select value={filters.status} onChange={(e) => update("status", e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {(["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"] as LeadStatus[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select value={filters.stageId} onChange={(e) => update("stageId", e.target.value)} aria-label="Stage">
            <option value="">Any stage</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>

          {canBulkAct && (
            <Select value={filters.ownerId} onChange={(e) => update("ownerId", e.target.value)} aria-label="Owner">
              <option value="">Any owner</option>
              {(employees ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </Select>
          )}
          <Input placeholder="Source" value={filters.source} onChange={(e) => update("source", e.target.value)} aria-label="Source" />
          <Select value={filters.priority} onChange={(e) => update("priority", e.target.value)} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Select value={filters.minScore} onChange={(e) => update("minScore", e.target.value)} aria-label="Minimum score">
            <option value="">Any score</option>
            <option value={String(scoreConfig?.hotThreshold ?? 80)}>Hot only</option>
            <option value={String(scoreConfig?.warmThreshold ?? 50)}>Warm and above</option>
          </Select>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Follow-up due before
            <Input type="date" value={filters.followUpTo} onChange={(e) => update("followUpTo", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Created on or after
            <Input type="date" value={filters.createdFrom} onChange={(e) => update("createdFrom", e.target.value)} />
          </label>
          <Select value={filters.sort} onChange={(e) => update("sort", e.target.value)} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="score">Highest score</option>
            <option value="followUp">Next follow-up</option>
            <option value="lastContacted">Recently contacted</option>
          </Select>

          <div className="flex flex-wrap items-center gap-4 text-sm text-ink md:col-span-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={filters.unassigned} onChange={(e) => update("unassigned", e.target.checked)} />
              Unassigned only
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={filters.overdue} onChange={(e) => update("overdue", e.target.checked)} />
              SLA overdue only
            </label>
            <button
              type="button"
              className="text-xs text-emerald underline"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
            >
              Clear filters
            </button>
            <span className="ml-auto text-xs text-muted">{data?.total ?? 0} matching leads</span>
          </div>
        </div>
      </Card>

      {canBulkAct && selected.size > 0 && (
        <Card className="border-emerald/40 bg-emerald/5">
          <div className="flex flex-wrap items-end gap-3">
            <p className="text-sm font-medium text-ink">{selected.size} selected</p>

            <div className="flex items-end gap-2">
              <Select className="w-44" value={bulkOwnerId} onChange={(e) => setBulkOwnerId(e.target.value)} aria-label="Assign to">
                <option value="">Auto-assign by rule</option>
                {(employees ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                disabled={bulk.isPending}
                onClick={() => bulk.mutate({ path: "assign", body: bulkOwnerId ? { ownerId: bulkOwnerId } : {} })}
              >
                Assign
              </Button>
            </div>

            <div className="flex items-end gap-2">
              <Select className="w-44" value={bulkStageId} onChange={(e) => setBulkStageId(e.target.value)} aria-label="Move to stage">
                <option value="">Move to stage…</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              {selectedStage?.isLost && (
                <Select
                  className="w-40"
                  value={bulkLossReason}
                  onChange={(e) => setBulkLossReason(e.target.value as LeadLossReason)}
                  aria-label="Reason"
                >
                  {LOSS_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {LOSS_REASON_LABEL[r]}
                    </option>
                  ))}
                </Select>
              )}
              <Button
                variant="secondary"
                disabled={!bulkStageId || bulk.isPending}
                onClick={() =>
                  bulk.mutate({
                    path: "stage",
                    body: selectedStage?.isLost
                      ? { stageId: bulkStageId, lossReason: bulkLossReason }
                      : { stageId: bulkStageId },
                  })
                }
              >
                Move
              </Button>
            </div>

            <div className="flex items-end gap-2">
              <Input className="w-36" placeholder="Tag" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} aria-label="Tag to add" />
              <Button
                variant="secondary"
                disabled={!bulkTag.trim() || bulk.isPending}
                onClick={() => bulk.mutate({ path: "tag", body: { tags: [bulkTag.trim()] } })}
              >
                Tag
              </Button>
            </div>

            <Button
              variant="danger"
              disabled={bulk.isPending}
              onClick={() => {
                if (confirm(`Permanently delete ${selected.size} lead${selected.size === 1 ? "" : "s"}? This can't be undone.`)) {
                  bulk.mutate({ path: "delete", body: {} });
                }
              }}
            >
              Delete permanently
            </Button>

            <a href="/api/v1/exports/leads.csv" className="ml-auto">
              <Button variant="secondary">Export all as CSV</Button>
            </a>
          </div>
          <p className="mt-2 text-xs text-muted">
            Prefer moving a bad batch to a loss stage with a reason over deleting it — that stays reversible and keeps
            history. Reach for &ldquo;Delete permanently&rdquo; only when the rows themselves need to go, e.g. a bad test import.
          </p>
        </Card>
      )}

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message="Could not load leads." />
      ) : rows.length === 0 ? (
        <EmptyState title="No leads match" description="Try clearing a filter or widening the date range." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-canvas/60 text-xs uppercase tracking-wide text-muted">
                {canBulkAct && (
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      aria-label="Select every lead on this page"
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (allOnPageSelected) rows.forEach((r) => next.delete(r.id));
                          else rows.forEach((r) => next.add(r.id));
                          return next;
                        })
                      }
                    />
                  </th>
                )}
                <th scope="col" className="px-3 py-2.5 text-left">Lead</th>
                <th scope="col" className="px-3 py-2.5 text-left">Stage</th>
                <th scope="col" className="px-3 py-2.5 text-left">Score</th>
                <th scope="col" className="px-3 py-2.5 text-left">Owner</th>
                <th scope="col" className="px-3 py-2.5 text-left">Next follow-up</th>
                <th scope="col" className="px-3 py-2.5 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((lead) => {
                const followUp = formatWhen(lead.nextFollowUpAt);
                return (
                  <tr key={lead.id} className="border-b border-border last:border-0 hover:bg-canvas/40">
                    {canBulkAct && (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={() => toggle(lead.id)}
                          aria-label={`Select ${lead.fullName}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <Link href={`/leads/${lead.id}`} className="font-medium text-ink hover:text-emerald-dark hover:underline">
                        {lead.fullName}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {lead.company && <span>{lead.company}</span>}
                        {lead.phone && <span>· {lead.phone}</span>}
                        <PriorityBadge priority={lead.priority} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-ink">{lead.stage?.name ?? "—"}</span>
                        <Badge tone={STATUS_TONE[lead.status]}>{lead.status}</Badge>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreBadge
                        score={lead.score}
                        band={bandFor(lead.score, scoreConfig?.hotThreshold, scoreConfig?.warmThreshold)}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-ink">{lead.owner?.fullName ?? "Unassigned"}</td>
                    <td className={`px-3 py-2.5 ${followUp.overdue ? "font-medium text-coral" : "text-muted"}`}>
                      {followUp.overdue && lead.nextFollowUpAt ? "Overdue · " : ""}
                      {followUp.label}
                    </td>
                    <td className="px-3 py-2.5 text-muted">{lead.source ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm text-muted">
          <span>
            Page {data.page} of {data.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="secondary" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
