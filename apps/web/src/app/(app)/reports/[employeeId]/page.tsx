"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { EmployeeTotalReport } from "@zulivio/types";
import { api } from "@/lib/api";
import { Card, ErrorState, Spinner } from "@/components/ui";

export default function EmployeeReportPage() {
  const params = useParams<{ employeeId: string }>();
  const { data, isLoading, error } = useQuery<EmployeeTotalReport>({
    queryKey: ["reports", "employee", params.employeeId],
    queryFn: () => api.get<EmployeeTotalReport>(`/api/v1/reports/employees/${params.employeeId}`),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load this employee's report." />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-ink">Employee report</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Net worked" value={formatMinutes(data.attendance.totalNetWorkedMinutes)} />
        <Stat label="Break time" value={formatMinutes(data.attendance.totalBreakMinutes)} />
        <Stat label="Shifts" value={data.attendance.sessionCount} />
        <Stat label="Logins" value={data.loginCount} />
        <Stat label="Training acknowledged" value={data.trainingAcknowledged} />
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Assignments</h2>
        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-5">
          <Stat label="Total" value={data.assignments.total} compact />
          <Stat label="Completed" value={data.assignments.completed} compact />
          <Stat label="In progress" value={data.assignments.inProgress} compact />
          <Stat label="Follow-up" value={data.assignments.followUp} compact />
          <Stat label="Blocked" value={data.assignments.blocked} compact />
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Shift history</h2>
        {data.attendance.sessions.length === 0 ? (
          <p className="text-sm text-muted">No shifts recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="pb-2">Login</th>
                  <th className="pb-2">Logout</th>
                  <th className="pb-2">Net worked</th>
                  <th className="pb-2">Breaks</th>
                </tr>
              </thead>
              <tbody>
                {data.attendance.sessions.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-2">{new Date(s.startedAt).toLocaleString()}</td>
                    <td className="py-2">{s.endedAt ? new Date(s.endedAt).toLocaleString() : "Still working"}</td>
                    <td className="py-2">{formatMinutes(s.netWorkedMinutes)}</td>
                    <td className="py-2">{s.breakCount} ({formatMinutes(s.breakMinutes)})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, compact }: { label: string; value: string | number; compact?: boolean }) {
  return (
    <Card className={compact ? "p-3" : undefined}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={compact ? "mt-1 text-lg font-semibold text-ink" : "mt-1 text-2xl font-semibold text-ink"}>
        {value}
      </p>
    </Card>
  );
}

function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${hours}h ${minutes}m`;
}
