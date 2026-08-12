"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardData } from "@zulivio/types";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { api } from "@/lib/api";
import { Badge, Card, ErrorState, Spinner } from "@/components/ui";

export function Dashboard() {
  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["reports", "dashboard"],
    queryFn: () => api.get<DashboardData>("/api/v1/reports/dashboard"),
    refetchInterval: 30_000,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load the dashboard." />;

  const statusRows = Object.entries(data.assignments.byStatus).map(([status, count]) => ({
    status: status.replace("_", " "),
    count,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Master dashboard</h1>
        <p className="text-sm text-muted">
          Generated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Active employees" value={`${data.headcount.active} / ${data.headcount.total}`} />
        <StatCard label="Working now" value={data.workingNow} tone="success" />
        <StatCard label="On break" value={data.onBreakNow} tone="warning" />
        <StatCard label="Overdue assignments" value={data.assignments.overdue} tone={data.assignments.overdue > 0 ? "danger" : "neutral"} />
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Assignments by status</h2>
        {statusRows.length === 0 ? (
          <p className="text-sm text-muted">No assignments yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={statusRows}>
              <XAxis dataKey="status" fontSize={12} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip />
              <Bar dataKey="count" fill="#168b65" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Live attendance</h2>
        {data.liveAttendance.length === 0 ? (
          <p className="text-sm text-muted">No one is currently on the clock.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.liveAttendance.map((row) => (
              <li key={row.employeeId} className="flex items-center justify-between text-sm">
                <span>
                  {row.employeeName}{" "}
                  <span className="text-muted">({row.employeeNumber})</span>
                </span>
                <Badge tone={row.state === "working" ? "success" : "warning"}>
                  {row.state === "working" ? "Working" : "On break"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneColor: Record<string, string> = {
    neutral: "text-ink",
    success: "text-emerald-dark",
    warning: "text-amber",
    danger: "text-coral",
  };
  return (
    <Card>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneColor[tone]}`}>{value}</p>
    </Card>
  );
}
