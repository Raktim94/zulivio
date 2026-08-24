"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CrmOverviewData, TeamPerformanceData } from "@zulivio/types";
import { api } from "@/lib/api";
import { Card, EmptyState, ErrorState, Input, Spinner, StatCard, TabPanel, Tabs } from "@/components/ui";
import { formatAmount } from "@/components/crm";
import { isManagerOrAbove, useCurrentEmployee } from "@/lib/use-current-employee";
import { useRequireRole } from "@/lib/use-require-role";

/**
 * One categorical palette, reused across every chart on this page so the
 * same series colour means the same thing wherever it appears. Drawn from
 * the app's own design tokens rather than a chart-library default.
 */
const SERIES = {
  primary: "#106e51",
  secondary: "#5b5bd6",
  warning: "#d99a2b",
  danger: "#e66e58",
};
const CATEGORICAL = [SERIES.primary, SERIES.secondary, SERIES.warning, SERIES.danger, "#0d5841", "#8484e8"];

const AXIS = { fontSize: 12, stroke: "var(--color-muted)" };

/** Shared tooltip styling so every chart reads the same in light and dark. */
const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.5rem",
    fontSize: 12,
    color: "var(--color-ink)",
  },
} as const;

/**
 * Local calendar date as YYYY-MM-DD, for the two <input type="date"> fields.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that yields the *UTC* date,
 * while the range below is parsed back as local time. In any timezone ahead
 * of UTC the two disagree for part of the evening — under IST, opening this
 * page after 5:30 PM produced a "to" bound earlier than the records created
 * moments before, so the whole report rendered as zeroes.
 */
function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDate(date);
}

/**
 * CRM reporting. Team performance is manager-and-above; the org-wide CRM
 * overview is admin-only — both gated server-side as well, this just avoids
 * rendering a panel the API would refuse.
 */
export default function CrmReportsPage() {
  const { isLoading: authLoading, authorized } = useRequireRole(isManagerOrAbove);
  const { data: employee } = useCurrentEmployee();
  const isAdmin = employee?.role === "COMPANY_ADMIN" || employee?.role === "MASTER_OWNER";

  const [tab, setTab] = useState("team");
  const [from, setFrom] = useState(localDateDaysAgo(30));
  const [to, setTo] = useState(localDate());

  if (authLoading) return <Spinner />;
  if (!authorized) return null; // redirecting

  const range = `from=${new Date(from).toISOString()}&to=${new Date(`${to}T23:59:59`).toISOString()}`;

  const tabs = [
    { id: "team", label: "Team performance" },
    ...(isAdmin ? [{ id: "overview", label: "CRM overview" }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">CRM reports</h1>
          <p className="text-sm text-muted">Calling activity, conversion and revenue across the team.</p>
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
          <Link href="/sales-dashboard" className="pb-2 text-xs text-emerald underline">
            Deal forecast →
          </Link>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <TabPanel id="team" active={tab}>
        <TeamPerformancePanel range={range} />
      </TabPanel>

      {isAdmin && (
        <TabPanel id="overview" active={tab}>
          <CrmOverviewPanel range={range} />
        </TabPanel>
      )}
    </div>
  );
}

function TeamPerformancePanel({ range }: { range: string }) {
  const { data, isLoading, error } = useQuery<TeamPerformanceData>({
    queryKey: ["reports", "team-performance", range],
    queryFn: () => api.get<TeamPerformanceData>(`/api/v1/reports/team-performance?${range}`),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load team performance." />;

  const { kpis } = data;
  const activeRows = data.perEmployee.filter((row) => row.calls > 0 || row.leadsHandled > 0);
  const comparison = activeRows
    .map((row) => ({
      name: row.fullName.split(" ")[0],
      Calls: row.calls,
      Connected: row.connected,
      Qualified: row.leadsQualified,
      Won: row.dealsWon,
    }))
    .slice(0, 12);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Leads in range" value={kpis.totalLeads} />
        <StatCard label="Qualified" value={kpis.qualified} tone="success" />
        <StatCard label="Conversion rate" value={`${kpis.conversionRate}%`} tone="info" />
        <StatCard label="Revenue won" value={formatAmount(kpis.revenueMinor)} tone="success" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Connected" value={kpis.connected} />
        <StatCard label="Meetings booked" value={kpis.meetingsBooked} />
        <StatCard label="Proposals sent" value={kpis.proposalsSent} />
        <StatCard label="Lost" value={kpis.lost} tone={kpis.lost > 0 ? "danger" : "neutral"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Leads by stage</h2>
          {data.leadsByStage.every((s) => s.count === 0) ? (
            <p className="text-sm text-muted">No leads created in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <ResponsiveContainer width="100%" height={280} minWidth={320}>
                <BarChart data={data.leadsByStage} margin={{ bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="stageName" {...AXIS} angle={-30} textAnchor="end" height={60} interval={0} />
                  <YAxis {...AXIS} allowDecimals={false} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [v, "Leads"]} />
                  <Bar dataKey="count" fill={SERIES.primary} radius={[4, 4, 0, 0]} name="Leads" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Leads by source</h2>
          {data.leadsBySource.length === 0 ? (
            <p className="text-sm text-muted">Nothing attributed yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data.leadsBySource}
                  dataKey="count"
                  nameKey="source"
                  outerRadius={90}
                  label={(entry: { source: string; count: number }) => `${entry.source} (${entry.count})`}
                >
                  {data.leadsBySource.map((_, i) => (
                    <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-1 text-sm font-medium text-ink">Telecaller comparison</h2>
          <p className="mb-4 text-xs text-muted">Only people with activity in this range are charted.</p>
          {comparison.length === 0 ? (
            <EmptyState title="No calling activity yet" description="Logged calls will show up here." />
          ) : (
            <div className="overflow-x-auto">
              <ResponsiveContainer width="100%" height={300} minWidth={420}>
                <BarChart data={comparison}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" {...AXIS} />
                  <YAxis {...AXIS} allowDecimals={false} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Calls" fill={SERIES.secondary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Connected" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Qualified" fill={SERIES.warning} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Won" fill={SERIES.danger} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Per-telecaller performance</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="pb-2 font-medium">Telecaller</th>
                <th scope="col" className="pb-2 font-medium">Calls</th>
                <th scope="col" className="pb-2 font-medium">Connect rate</th>
                <th scope="col" className="pb-2 font-medium">Leads</th>
                <th scope="col" className="pb-2 font-medium">Qualified</th>
                <th scope="col" className="pb-2 font-medium">Meetings</th>
                <th scope="col" className="pb-2 font-medium">Follow-ups done</th>
                <th scope="col" className="pb-2 font-medium">Overdue</th>
                <th scope="col" className="pb-2 font-medium">Won</th>
                <th scope="col" className="pb-2 font-medium">Revenue</th>
                <th scope="col" className="pb-2 font-medium">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {data.perEmployee.map((row) => (
                <tr key={row.employeeId} className="border-b border-border last:border-0 hover:bg-canvas/40">
                  <td className="py-2 text-ink">
                    <Link href={`/reports/${row.employeeId}`} className="hover:text-emerald-dark hover:underline">
                      {row.fullName}
                    </Link>
                    <span className="block text-xs text-muted">{row.employeeNumber}</span>
                  </td>
                  <td className="py-2 text-muted">{row.calls}</td>
                  <td className="py-2 text-muted">{row.connectRate}%</td>
                  <td className="py-2 text-muted">{row.leadsHandled}</td>
                  <td className="py-2 text-muted">{row.leadsQualified}</td>
                  <td className="py-2 text-muted">{row.meetingsBooked}</td>
                  <td className="py-2 text-muted">{row.followUpsCompleted}</td>
                  <td className={row.followUpsOverdue > 0 ? "py-2 font-medium text-coral" : "py-2 text-muted"}>
                    {row.followUpsOverdue}
                  </td>
                  <td className="py-2 text-muted">{row.dealsWon}</td>
                  <td className="py-2 font-medium text-emerald-dark">{formatAmount(row.revenueMinor)}</td>
                  <td className="py-2 text-muted">{row.conversionRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function CrmOverviewPanel({ range }: { range: string }) {
  // No role hook here: the tab that renders this panel is admin-only, and
  // the endpoint itself refuses anyone else — a second redirect hook would
  // just fight the page-level one.
  const { data, isLoading, error } = useQuery<CrmOverviewData>({
    queryKey: ["reports", "crm-overview", range],
    queryFn: () => api.get<CrmOverviewData>(`/api/v1/reports/crm-overview?${range}`),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load the CRM overview." />;

  const revenueSeries = data.dailyTrend.map((d) => ({
    date: d.date,
    Revenue: d.revenueMinor / 100,
    "New leads": d.newLeads,
    Converted: d.converted,
  }));

  const followUp = data.followUpPerformance;
  const followUpData = [
    { name: "Completed", value: followUp.completed },
    { name: "Pending", value: followUp.pending },
    { name: "Overdue", value: followUp.overdue },
    { name: "Canceled", value: followUp.canceled },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total leads" value={data.totals.totalLeads} />
        <StatCard label="Active employees" value={data.totals.activeEmployees} />
        <StatCard label="Revenue in range" value={formatAmount(data.totals.revenueMinor)} tone="success" />
        <StatCard label="Open pipeline" value={formatAmount(data.totals.openPipelineMinor)} tone="info" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-sm font-medium text-ink">Conversion funnel</h2>
          <p className="mb-4 text-xs text-muted">Leads created in this range, by the stage they reached.</p>
          {data.funnel.every((f) => f.count === 0) ? (
            <p className="text-sm text-muted">No leads created in this range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.funnel} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" {...AXIS} allowDecimals={false} />
                <YAxis type="category" dataKey="label" {...AXIS} width={110} interval={0} />
                <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [v, "Leads"]} />
                <Bar dataKey="count" fill={SERIES.secondary} radius={[0, 4, 4, 0]} name="Leads" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-medium text-ink">Pipeline value by stage</h2>
          <p className="mb-4 text-xs text-muted">Open deals on the opportunity pipeline.</p>
          {data.pipelineValueByStage.length === 0 ? (
            <p className="text-sm text-muted">No open opportunities.</p>
          ) : (
            <div className="overflow-x-auto">
              <ResponsiveContainer width="100%" height={300} minWidth={320}>
                <BarChart data={data.pipelineValueByStage.map((s) => ({ ...s, value: s.valueMinor / 100 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="stageName" {...AXIS} />
                  <YAxis {...AXIS} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`₹${v.toLocaleString()}`, "Value"]} />
                  <Bar dataKey="value" fill={SERIES.primary} radius={[4, 4, 0, 0]} name="Value" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-1 text-sm font-medium text-ink">Revenue and lead flow</h2>
          <p className="mb-4 text-xs text-muted">Daily won revenue against new and converted leads.</p>
          <div className="overflow-x-auto">
            <ResponsiveContainer width="100%" height={300} minWidth={480}>
              <LineChart data={revenueSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis yAxisId="left" {...AXIS} />
                <YAxis yAxisId="right" orientation="right" {...AXIS} allowDecimals={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="Revenue" stroke={SERIES.primary} strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="New leads" stroke={SERIES.secondary} strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="Converted" stroke={SERIES.warning} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-medium text-ink">Follow-up completion</h2>
          <p className="mb-4 text-xs text-muted">
            Overdue is the number that matters — {followUp.overdue} open past their due time.
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={followUpData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} name="Follow-ups">
                {followUpData.map((entry, i) => (
                  <Cell key={i} fill={entry.name === "Overdue" ? SERIES.danger : CATEGORICAL[i % CATEGORICAL.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="mb-1 text-sm font-medium text-ink">Assignment distribution</h2>
          <p className="mb-4 text-xs text-muted">Open leads held per owner, right now.</p>
          {data.assignmentDistribution.length === 0 ? (
            <p className="text-sm text-muted">No open leads.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {[...data.assignmentDistribution]
                .sort((a, b) => b.openLeads - a.openLeads)
                .map((row) => {
                  const max = Math.max(...data.assignmentDistribution.map((r) => r.openLeads), 1);
                  return (
                    <li key={row.ownerId ?? "unassigned"} className="flex items-center gap-3 text-sm">
                      <span className="w-32 shrink-0 truncate text-ink">{row.ownerName}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                        <span
                          className="block h-full rounded-full bg-emerald"
                          style={{ width: `${(row.openLeads / max) * 100}%` }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right text-muted">{row.openLeads}</span>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
