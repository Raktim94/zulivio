"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AttendanceReport, DashboardData, EmployeeSummary, TeamAttendanceRow } from "@zulivio/types";
import { api } from "@/lib/api";
import { AttendanceWidget } from "@/components/attendance-widget";
import { Badge, Card, ErrorState, Input, Spinner, StatCard } from "@/components/ui";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local YYYY-MM-DD — matches the report's session dates, which are keyed off local calendar days. */
function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateKey(date);
}

function formatHoursMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

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

      {employee && <MyCalendar employeeId={employee.id} />}

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

      {managerView && <TeamAttendance />}

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

/**
 * An employee's present/absent calendar for a month. There's no roster or
 * holiday model in this app, so "absent" just means no work session was
 * started that calendar day — weekends will naturally show absent unless
 * someone actually clocked in.
 */
function MyCalendar({ employeeId }: { employeeId: string }) {
  const [monthOffset, setMonthOffset] = useState(0);

  const { monthStart, monthEnd, label, isCurrentMonth } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      monthStart: start,
      monthEnd: end,
      label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      isCurrentMonth: monthOffset === 0,
    };
  }, [monthOffset]);

  const { data, isLoading, error } = useQuery<AttendanceReport>({
    queryKey: ["attendance", "me", employeeId, monthStart.toISOString()],
    queryFn: () =>
      api.get<AttendanceReport>(
        `/api/v1/work-sessions/report/${employeeId}?from=${monthStart.toISOString()}&to=${monthEnd.toISOString()}`,
      ),
  });

  const presentDays = useMemo(() => {
    const days = new Set<string>();
    for (const session of data?.sessions ?? []) {
      days.add(localDateKey(new Date(session.startedAt)));
    }
    return days;
  }, [data]);

  const today = new Date();
  const daysInMonth = monthEnd.getDate();
  const leadingBlanks = monthStart.getDay();
  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1)),
  ];

  let daysElapsed = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
    if (day <= today) daysElapsed++;
  }
  const daysAbsent = Math.max(0, daysElapsed - presentDays.size);

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink">Your calendar</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonthOffset((o) => o - 1)}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <span className="w-36 text-center text-sm font-medium text-ink">{label}</span>
          <button
            type="button"
            onClick={() => setMonthOffset((o) => Math.min(0, o + 1))}
            disabled={isCurrentMonth}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message="Could not load your attendance." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Days present" value={presentDays.size} tone="success" />
            <StatCard label="Days absent" value={daysAbsent} tone={daysAbsent > 0 ? "danger" : "neutral"} />
            <StatCard label="Worked" value={formatHoursMinutes(data.totalNetWorkedMinutes)} />
            <StatCard label="On break" value={formatHoursMinutes(data.totalBreakMinutes)} tone="warning" />
          </div>

          <div>
            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-medium uppercase tracking-wide text-muted">
              {WEEKDAY_LABELS.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((day, i) => {
                if (!day) return <div key={`blank-${i}`} />;
                const key = localDateKey(day);
                const isFuture = day > today;
                const isPresent = presentDays.has(key);
                return (
                  <div
                    key={key}
                    title={isFuture ? undefined : isPresent ? "Present" : "Absent"}
                    className={clsx(
                      "flex aspect-square items-center justify-center rounded-md text-xs",
                      isFuture && "text-muted",
                      !isFuture && isPresent && "bg-emerald/15 font-medium text-emerald-dark",
                      !isFuture && !isPresent && "bg-coral/10 text-coral",
                    )}
                  >
                    {day.getDate()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Manager+ inline summary of everyone's attendance and call volume for a date range — drill into "Attendance reports" below for shift-by-shift detail on one person. */
function TeamAttendance() {
  const [from, setFrom] = useState(localDateDaysAgo(30));
  const [to, setTo] = useState(localDateKey(new Date()));

  const range = `from=${new Date(from).toISOString()}&to=${new Date(`${to}T23:59:59`).toISOString()}`;

  const { data, isLoading, error } = useQuery<TeamAttendanceRow[]>({
    queryKey: ["attendance", "team", range],
    queryFn: () => api.get<TeamAttendanceRow[]>(`/api/v1/work-sessions/team-report?${range}`),
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-ink">Team attendance</h2>
          <p className="text-xs text-muted">Days present, worked time and calls for everyone in your team.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            From
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            To
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </label>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState message="Could not load team attendance." />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted">No one in your team yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="pb-2 font-medium">Employee</th>
                <th scope="col" className="pb-2 font-medium">Days present</th>
                <th scope="col" className="pb-2 font-medium">Shifts</th>
                <th scope="col" className="pb-2 font-medium">Worked</th>
                <th scope="col" className="pb-2 font-medium">On break</th>
                <th scope="col" className="pb-2 font-medium">Calls</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.employeeId} className="border-b border-border last:border-0 hover:bg-canvas/40">
                  <td className="py-2 text-ink">
                    {row.fullName}
                    <span className="block text-xs text-muted">{row.employeeNumber}</span>
                  </td>
                  <td className="py-2 text-muted">{row.daysPresent}</td>
                  <td className="py-2 text-muted">{row.sessionCount}</td>
                  <td className="py-2 text-muted">{formatHoursMinutes(row.totalNetWorkedMinutes)}</td>
                  <td className="py-2 text-muted">{formatHoursMinutes(row.totalBreakMinutes)}</td>
                  <td className="py-2 text-muted">{row.calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
