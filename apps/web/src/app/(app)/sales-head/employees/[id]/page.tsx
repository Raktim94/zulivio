"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SalesHeadEmployeeDetail } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { isSalesHeadOrAbove } from "@/lib/use-current-employee";
import { useRequireRole } from "@/lib/use-require-role";
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  Skeleton,
  Tabs,
  TabPanel,
  useToast,
} from "@/components/ui";

function formatAmount(minor: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    minor / 100,
  );
}

export default function SalesHeadEmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const { isLoading: authLoading, authorized } = useRequireRole(isSalesHeadOrAbove);
  const [tab, setTab] = useState("overview");
  const [assignOpen, setAssignOpen] = useState(false);

  const { data, isLoading, error } = useQuery<SalesHeadEmployeeDetail>({
    queryKey: ["sales-head", "employees", params.id],
    queryFn: () => api.get<SalesHeadEmployeeDetail>(`/api/v1/sales-head/employees/${params.id}`),
    enabled: authorized,
  });

  if (authLoading) return <Skeleton className="h-64" />;
  if (!authorized) return null; // redirecting
  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorState message="Could not load this employee." />;

  const { employee, attendance, assignments, leads, opportunities, qualityResults, recentAudit } = data;
  const openPipelineValue = opportunities
    .filter((o) => o.status === "OPEN")
    .reduce((sum, o) => sum + o.amountMinor, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {employee.fullName} <span className="text-base font-normal text-muted">({employee.employeeNumber})</span>
          </h1>
          <p className="text-sm text-muted">
            {employee.role.replace(/_/g, " ")} · {employee.department ?? "No department"}
          </p>
        </div>
        <Button onClick={() => setAssignOpen(true)}>Assign task</Button>
      </div>

      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "tasks", label: `Tasks (${assignments.length})` },
          { id: "sales", label: `Sales (${leads.length + opportunities.length})` },
          { id: "quality", label: `Quality (${qualityResults.length})` },
          { id: "audit", label: "Audit History" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <TabPanel id="overview" active={tab}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Attendance</p>
            <p className="mt-1.5 text-2xl font-semibold text-ink">
              {attendance.state === "logged_out" ? "Off shift" : attendance.state === "working" ? "Working" : "On break"}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Open tasks</p>
            <p className="mt-1.5 text-2xl font-semibold text-ink">
              {assignments.filter((a) => !["COMPLETED", "CANCELED"].includes(a.status)).length}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Open leads</p>
            <p className="mt-1.5 text-2xl font-semibold text-ink">
              {leads.filter((l) => ["NEW", "CONTACTED", "QUALIFIED"].includes(l.status)).length}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Pipeline value</p>
            <p className="mt-1.5 text-2xl font-semibold text-ink">{formatAmount(openPipelineValue)}</p>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="tasks" active={tab}>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted">No assignments yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {assignments.map((a) => (
              <Card key={a.id} className="flex items-center justify-between gap-4">
                <span className="text-sm text-ink">
                  #{a.assignmentNumber} {a.title}
                </span>
                <Badge tone={a.status === "COMPLETED" ? "success" : "info"}>{a.status.replace("_", " ")}</Badge>
              </Card>
            ))}
          </div>
        )}
      </TabPanel>

      <TabPanel id="sales" active={tab}>
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Leads</h3>
            {leads.length === 0 ? (
              <p className="text-sm text-muted">No leads yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {leads.map((l) => (
                  <Card key={l.id} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ink">{l.fullName}</span>
                    <Badge tone="info">{l.status}</Badge>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Opportunities</h3>
            {opportunities.length === 0 ? (
              <p className="text-sm text-muted">No opportunities yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {opportunities.map((o) => (
                  <Card key={o.id} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-ink">{o.title}</span>
                    <span className="text-sm text-muted">{formatAmount(o.amountMinor)}</span>
                    <Badge tone={o.status === "WON" ? "success" : o.status === "LOST" ? "danger" : "info"}>
                      {o.status}
                    </Badge>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </TabPanel>

      <TabPanel id="quality" active={tab}>
        {qualityResults.length === 0 ? (
          <p className="text-sm text-muted">No published quality reviews yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {qualityResults.map((r) => (
              <Card key={r.id} className="flex items-center justify-between gap-4">
                <span className="text-sm text-ink">{r.definition.name}</span>
                <Badge tone="success">{r.overallScore}</Badge>
              </Card>
            ))}
          </div>
        )}
      </TabPanel>

      <TabPanel id="audit" active={tab}>
        {recentAudit.length === 0 ? (
          <p className="text-sm text-muted">No recent activity recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentAudit.map((e) => (
              <li key={e.id} className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0 first:pt-0">
                <span className="text-ink">{e.action.replace(/_/g, " ").replace(/\./g, " ")}</span>
                <span className="text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </TabPanel>

      <AssignTaskDialog open={assignOpen} onClose={() => setAssignOpen(false)} employeeId={employee.id} />
    </div>
  );
}

function AssignTaskDialog({ open, onClose, employeeId }: { open: boolean; onClose: () => void; employeeId: string }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createAssignment = useMutation({
    mutationFn: () => api.post("/api/v1/assignments", { title, ownerId: employeeId }),
    onSuccess: () => {
      setError(null);
      setTitle("");
      onClose();
      queryClient.invalidateQueries({ queryKey: ["sales-head"] });
      push("Task assigned.", "success");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not assign this task"),
  });

  return (
    <Dialog open={open} onClose={onClose} title="Assign task">
      {error && <ErrorState message={error} />}
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          createAssignment.mutate();
        }}
      >
        <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <Button type="submit" disabled={createAssignment.isPending || !title.trim()}>
          {createAssignment.isPending ? "Assigning..." : "Assign"}
        </Button>
      </form>
    </Dialog>
  );
}
