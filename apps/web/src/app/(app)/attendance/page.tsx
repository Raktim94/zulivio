"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { DashboardData, EmployeeSummary } from "@zulivio/types";
import { api } from "@/lib/api";
import { AttendanceWidget } from "@/components/attendance-widget";
import { Badge, Card, ErrorState, Spinner } from "@/components/ui";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";

export default function AttendancePage() {
  const { data: employee } = useCurrentEmployee();
  const managerView = isManagerOrAbove(employee?.role);

  const { data: dashboard } = useQuery<DashboardData>({
    queryKey: ["reports", "dashboard"],
    queryFn: () => api.get<DashboardData>("/api/v1/reports/dashboard"),
    enabled: managerView,
    refetchInterval: 20_000,
  });

  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
    enabled: managerView,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Attendance</h1>
        <p className="text-sm text-muted">Shift, break, and team on-the-clock status.</p>
      </div>

      <AttendanceWidget />

      {managerView && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Team status</h2>
          {!dashboard ? (
            <Spinner />
          ) : dashboard.liveAttendance.length === 0 ? (
            <p className="text-sm text-muted">No one is currently on the clock.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dashboard.liveAttendance.map((row) => (
                <li key={row.employeeId} className="flex items-center justify-between text-sm">
                  <span>{row.employeeName} ({row.employeeNumber})</span>
                  <Badge tone={row.state === "working" ? "success" : "warning"}>
                    {row.state === "working" ? "Working" : "On break"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {managerView && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Attendance reports</h2>
          {!employees ? (
            <Spinner />
          ) : employees.length === 0 ? (
            <ErrorState message="No employees to report on yet." />
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {employees.map((emp) => (
                <li key={emp.id}>
                  <Link href={`/reports/${emp.id}`} className="text-emerald underline">
                    {emp.fullName} — full report
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
