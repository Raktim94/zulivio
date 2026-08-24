"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import clsx from "clsx";
import type { EmployeeSummary, FollowUpBucket, FollowUpDashboardData, FollowUpSummary } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Select, Spinner, StatCard, useToast } from "@/components/ui";
import { formatWhen } from "@/components/crm";
import { isManagerOrAbove, useCurrentEmployee } from "@/lib/use-current-employee";

const BUCKETS: { id: FollowUpBucket; label: string; description: string; tone: "danger" | "warning" | "neutral" }[] = [
  { id: "overdue", label: "Overdue", description: "Past due and still open — work these first.", tone: "danger" },
  { id: "dueNow", label: "Due now", description: "Due within the next 30 minutes.", tone: "warning" },
  { id: "dueToday", label: "Later today", description: "Due before the end of the day.", tone: "warning" },
  { id: "tomorrow", label: "Tomorrow", description: "Due tomorrow.", tone: "neutral" },
  { id: "upcoming", label: "Upcoming", description: "Everything scheduled after tomorrow.", tone: "neutral" },
];

/**
 * The follow-up queue, bucketed into the order a telecaller actually works
 * it. Completing and rescheduling happen inline — going into each lead to
 * clear a follow-up would make a 30-item queue a 60-click job.
 */
export default function FollowUpsPage() {
  const { data: employee } = useCurrentEmployee();
  const managerView = isManagerOrAbove(employee?.role);
  const [assigneeId, setAssigneeId] = useState("");

  const query = assigneeId ? `?assigneeId=${assigneeId}` : "";
  const { data, isLoading, error } = useQuery<FollowUpDashboardData>({
    queryKey: ["follow-ups", assigneeId],
    queryFn: () => api.get<FollowUpDashboardData>(`/api/v1/follow-ups${query}`),
    refetchInterval: 60_000,
  });

  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
    enabled: managerView,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load follow-ups." />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Follow-ups</h1>
          <p className="text-sm text-muted">
            {managerView ? "Your team's" : "Your"} scheduled follow-ups, grouped by when they are due.
          </p>
        </div>
        {managerView && (
          <Select
            className="w-56"
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            aria-label="Filter by assignee"
          >
            <option value="">Everyone in my team</option>
            {(employees ?? []).map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Overdue" value={data.counts.overdue} tone={data.counts.overdue > 0 ? "danger" : "neutral"} />
        <StatCard label="Due today" value={data.counts.dueNow + data.counts.dueToday} tone="warning" />
        <StatCard label="Tomorrow" value={data.counts.tomorrow} />
        <StatCard label="Completed this week" value={data.counts.completedThisWeek} tone="success" />
      </div>

      {BUCKETS.map((bucket) => {
        const items = data.buckets[bucket.id];
        return (
          <Card key={bucket.id}>
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-sm font-medium text-ink">{bucket.label}</h2>
              <Badge tone={items.length > 0 ? bucket.tone : "neutral"}>{items.length}</Badge>
            </div>
            <p className="mb-3 text-xs text-muted">{bucket.description}</p>

            {items.length === 0 ? (
              <p className="text-sm text-muted">Nothing here.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <FollowUpRow key={item.id} item={item} showAssignee={managerView} />
                ))}
              </ul>
            )}
          </Card>
        );
      })}

      {Object.values(data.buckets).every((list) => list.length === 0) && (
        <EmptyState
          title="No follow-ups scheduled"
          description="Schedule one from a lead's workspace after a call, and it will appear here."
        />
      )}
    </div>
  );
}

function FollowUpRow({ item, showAssignee }: { item: FollowUpSummary; showAssignee: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [rescheduling, setRescheduling] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [outcome, setOutcome] = useState("");

  const when = formatWhen(item.dueAt);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  const complete = useMutation({
    mutationFn: () => api.patch(`/api/v1/follow-ups/${item.id}/complete`, { outcome: outcome || undefined }),
    onSuccess: () => {
      invalidate();
      toast.push("Follow-up completed", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not complete", "error"),
  });

  const reschedule = useMutation({
    mutationFn: (iso: string) => api.patch(`/api/v1/follow-ups/${item.id}/reschedule`, { dueAt: iso }),
    onSuccess: () => {
      setRescheduling(false);
      setDueAt("");
      invalidate();
      toast.push("Follow-up rescheduled", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not reschedule", "error"),
  });

  return (
    <li className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/leads/${item.lead.id}`} className="text-sm font-medium text-ink hover:text-emerald-dark hover:underline">
            {item.lead.fullName}
          </Link>
          <p className="truncate text-xs text-muted">
            {[item.lead.company, item.lead.phone].filter(Boolean).join(" · ") || "No company on file"}
            {showAssignee && ` · ${item.assignee.fullName}`}
          </p>
          {item.note && <p className="mt-1 text-sm text-muted">{item.note}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx("text-xs font-medium", when.overdue ? "text-coral" : "text-muted")}>
            {when.overdue ? "Overdue · " : ""}
            {when.label}
          </span>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            disabled={complete.isPending}
            onClick={() => complete.mutate()}
          >
            Complete
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => setRescheduling((open) => !open)}
            aria-expanded={rescheduling}
          >
            Reschedule
          </Button>
        </div>
      </div>

      {rescheduling && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dueAt) reschedule.mutate(new Date(dueAt).toISOString());
          }}
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"
        >
          <label className="flex flex-col gap-1 text-xs text-muted">
            New date and time
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="w-56" />
          </label>
          <Button type="submit" className="px-3 py-1.5 text-xs" disabled={!dueAt || reschedule.isPending}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(10, 0, 0, 0);
              reschedule.mutate(tomorrow.toISOString());
            }}
          >
            Tomorrow 10 AM
          </Button>
        </form>
      )}

      {!rescheduling && (
        <Input
          className="mt-2 text-xs"
          placeholder="Outcome note (optional, saved when you complete)"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          aria-label={`Outcome note for ${item.lead.fullName}`}
        />
      )}
    </li>
  );
}
