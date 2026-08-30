"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { MeHomeData } from "@zulivio/types";
import { api } from "@/lib/api";
import { AttendanceWidget } from "@/components/attendance-widget";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";

export default function StartWorkPage() {
  const { data, isLoading, error } = useQuery<MeHomeData>({
    queryKey: ["me", "home"],
    queryFn: () => api.get<MeHomeData>("/api/v1/me/home"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Start Work</h1>
        <p className="text-sm text-muted">Clock in, then pick up what&apos;s next.</p>
      </div>

      <AttendanceWidget />

      {isLoading ? (
        <Skeleton className="h-32" />
      ) : error || !data ? (
        <ErrorState message="Could not load your work queue." />
      ) : data.attendance.state === "logged_out" ? (
        <EmptyState
          title="Clock in to see your work"
          description="Start your shift above, then your assigned work will appear here."
        />
      ) : data.activeWork.length === 0 && data.assignedLeads.length === 0 ? (
        <EmptyState
          title="Nothing assigned"
          description="No open assignment, lead, or campaign is waiting for you right now."
        />
      ) : (
        <>
          {data.activeWork.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-medium text-ink">Ready to work on</h2>
              <ul className="flex flex-col gap-2">
                {data.activeWork.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0 first:pt-0"
                  >
                    <span className="text-ink">
                      #{a.assignmentNumber} {a.title}
                    </span>
                    {a.dueAt && <span className="text-xs text-muted">Due {new Date(a.dueAt).toLocaleDateString()}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {data.assignedLeads.length > 0 && (
            <Card>
              <h2 className="mb-3 text-sm font-medium text-ink">
                Leads assigned to you {data.summary.openLeads > data.assignedLeads.length && `(${data.summary.openLeads} total)`}
              </h2>
              <ul className="flex flex-col gap-2">
                {data.assignedLeads.map((lead) => (
                  <li
                    key={lead.id}
                    className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0 first:pt-0"
                  >
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
        </>
      )}
    </div>
  );
}
