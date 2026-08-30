"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { MeHomeData } from "@zulivio/types";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";
import { api } from "@/lib/api";
import { Dashboard } from "@/components/dashboard";
import { AttendanceWidget } from "@/components/attendance-widget";
import { AssignmentList } from "@/components/assignment-list";
import { TipsFeed, TrainingFeed } from "@/components/tips-and-training";
import { Card, EmptyState, ErrorState, Skeleton, Spinner, StatCard } from "@/components/ui";

export default function OverviewPage() {
  const { data: employee, isLoading } = useCurrentEmployee();

  if (isLoading || !employee) return <Spinner />;

  if (isManagerOrAbove(employee.role)) {
    return <Dashboard />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Welcome back, {employee.fullName.split(" ")[0]}</h1>
        <p className="text-sm text-muted">Here&apos;s what needs your attention today.</p>
      </div>
      <AttendanceWidget />
      <HomeSummary />
      <div className="grid gap-6 md:grid-cols-2">
        <TipsFeed />
        <TrainingFeed />
      </div>
      <div>
        <h2 className="mb-3 text-sm font-medium text-ink">My Work</h2>
        <AssignmentList />
      </div>
    </div>
  );
}

function HomeSummary() {
  const { data, isLoading, error } = useQuery<MeHomeData>({
    queryKey: ["me", "home"],
    queryFn: () => api.get<MeHomeData>("/api/v1/me/home"),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (error || !data) return <ErrorState message="Could not load today's summary." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Assigned" value={data.summary.assigned} tone="info" />
        <StatCard label="In progress" value={data.summary.inProgress} tone="info" />
        <StatCard label="Follow-up" value={data.summary.followUp} tone="warning" />
        <StatCard label="Completed today" value={data.summary.completedToday} tone="success" />
      </div>
      {data.activeWork.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-medium text-ink">Active work</h2>
          <ul className="flex flex-col gap-2">
            {data.activeWork.map((a) => (
              <li key={a.id} className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0 first:pt-0">
                <span className="text-ink">
                  #{a.assignmentNumber} {a.title}
                </span>
                {a.dueAt && <span className="text-xs text-muted">Due {new Date(a.dueAt).toLocaleDateString()}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {data.activeWork.length === 0 && data.assignedLeads.length === 0 && (
        <EmptyState title="Nothing active" description="You're all caught up — no pending work right now." />
      )}
      {data.assignedLeads.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-medium text-ink">
            Leads assigned to you {data.summary.openLeads > data.assignedLeads.length && `(${data.summary.openLeads} total)`}
          </h2>
          <ul className="flex flex-col gap-2">
            {data.assignedLeads.map((lead) => (
              <li key={lead.id} className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0 first:pt-0">
                <Link href={`/leads/${lead.id}`} className="truncate text-ink hover:text-emerald-dark hover:underline">
                  {lead.fullName}
                  {lead.company && <span className="text-muted"> · {lead.company}</span>}
                </Link>
                <span className="shrink-0 text-xs text-muted">{lead.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
