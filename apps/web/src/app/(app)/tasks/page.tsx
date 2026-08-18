"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AssignmentSummary, MeTasksData } from "@zulivio/types";
import { api } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorState, Skeleton, Tabs, TabPanel } from "@/components/ui";

const TONE: Record<AssignmentSummary["status"], "neutral" | "success" | "warning" | "danger" | "info"> = {
  ASSIGNED: "info",
  IN_PROGRESS: "info",
  FOLLOW_UP: "warning",
  BLOCKED: "danger",
  COMPLETED: "success",
  CANCELED: "neutral",
};

function AssignmentRows({ items }: { items: AssignmentSummary[] }) {
  if (items.length === 0) {
    return <EmptyState title="Nothing here" description="No assignments in this view." />;
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((a) => (
        <Card key={a.id} className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">
              #{a.assignmentNumber} {a.title}
            </p>
            <p className="text-xs text-muted">
              {a.dueAt ? `Due ${new Date(a.dueAt).toLocaleDateString()}` : "No due date"}
            </p>
          </div>
          <Badge tone={TONE[a.status]}>{a.status.replace("_", " ")}</Badge>
        </Card>
      ))}
    </div>
  );
}

export default function TasksPage() {
  const [tab, setTab] = useState("pending");
  const { data, isLoading, error } = useQuery<MeTasksData>({
    queryKey: ["me", "tasks"],
    queryFn: () => api.get<MeTasksData>("/api/v1/me/tasks"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Tasks</h1>
        <p className="text-sm text-muted">Your assignments and in-progress helpdesk workflows, in one place.</p>
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error || !data ? (
        <ErrorState message="Could not load your tasks." />
      ) : (
        <>
          <Tabs
            tabs={[
              { id: "pending", label: `Pending (${data.pending.length})` },
              { id: "completed", label: `Completed (${data.completed.length})` },
              { id: "all", label: `All (${data.all.length})` },
              { id: "workflows", label: `Workflow Runs (${data.workflowRuns.length})` },
            ]}
            active={tab}
            onChange={setTab}
          />
          <TabPanel id="pending" active={tab}>
            <AssignmentRows items={data.pending} />
          </TabPanel>
          <TabPanel id="completed" active={tab}>
            <AssignmentRows items={data.completed} />
          </TabPanel>
          <TabPanel id="all" active={tab}>
            <AssignmentRows items={data.all} />
          </TabPanel>
          <TabPanel id="workflows" active={tab}>
            {data.workflowRuns.length === 0 ? (
              <EmptyState title="No workflow runs" description="Start one from the Helpdesk page." />
            ) : (
              <div className="flex flex-col gap-3">
                {data.workflowRuns.map((run) => (
                  <Card key={run.id} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-ink">{run.workflowDefinition?.name ?? "Workflow"}</p>
                      <p className="text-xs text-muted">Started {new Date(run.startedAt).toLocaleDateString()}</p>
                    </div>
                    <Badge tone={run.status === "COMPLETED" ? "success" : "info"}>
                      {run.status.replace("_", " ")}
                    </Badge>
                  </Card>
                ))}
              </div>
            )}
          </TabPanel>
        </>
      )}
    </div>
  );
}
