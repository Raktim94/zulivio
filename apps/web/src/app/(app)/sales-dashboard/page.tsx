"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OpportunitySummary, SalesDashboardData } from "@zulivio/types";
import { api } from "@/lib/api";
import { Badge, Card, Dialog, EmptyState, ErrorState, Spinner, StatCard } from "@/components/ui";
import { isManagerOrAbove } from "@/lib/use-current-employee";
import { useRequireRole } from "@/lib/use-require-role";

const PIE_COLORS = ["#168b65", "#d99a2b", "#5b5bd6", "#e66e58"];

function formatAmount(minor: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    minor / 100,
  );
}

export default function SalesDashboardPage() {
  const { isLoading: authLoading, authorized } = useRequireRole(isManagerOrAbove);
  const { data, isLoading, error } = useQuery<SalesDashboardData>({
    queryKey: ["reports", "sales-dashboard"],
    queryFn: () => api.get<SalesDashboardData>("/api/v1/reports/sales-dashboard"),
    refetchInterval: 30_000,
    enabled: authorized,
  });
  // Fetched lazily (only once a drill-down is actually opened) since it's
  // org-wide raw records, not needed for the aggregate charts above.
  const [drillDown, setDrillDown] = useState<{ label: string; ids: string[] } | null>(null);
  const { data: allOpportunities } = useQuery<OpportunitySummary[]>({
    queryKey: ["opportunities"],
    queryFn: () => api.get<OpportunitySummary[]>("/api/v1/opportunities"),
    enabled: authorized && drillDown !== null,
  });

  if (authLoading) return <Spinner />;
  if (!authorized) return null; // redirecting
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load the sales dashboard." />;

  const funnelData = Object.entries(data.leadFunnel).map(([status, count]) => ({ status, count }));
  const forecastData = Object.entries(data.forecastByCategory).map(([category, valueMinor]) => ({
    category: category.replace("_", " "),
    value: valueMinor / 100,
  }));
  const winRate =
    data.winLoss.won + data.winLoss.lost > 0
      ? Math.round((data.winLoss.won / (data.winLoss.won + data.winLoss.lost)) * 100)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Sales dashboard</h1>
        <p className="text-sm text-muted">Generated {new Date(data.generatedAt).toLocaleString()}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Open pipeline value" value={formatAmount(data.pipelineValue.totalMinor)} />
        <StatCard label="Weighted forecast" value={formatAmount(data.pipelineValue.weightedForecastMinor)} tone="success" />
        <StatCard label="Overdue leads" value={data.overdueLeads} tone={data.overdueLeads > 0 ? "danger" : "neutral"} />
        <StatCard label="Win rate" value={winRate !== null ? `${winRate}%` : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Pipeline value by stage</h2>
          <p className="-mt-3 mb-3 text-xs text-muted">Click a bar to see the underlying deals.</p>
          {data.stageBreakdown.length === 0 ? (
            <p className="text-sm text-muted">No opportunities yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.stageBreakdown.map((s) => ({ ...s, value: s.valueMinor / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="stageName" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => [`₹${v.toLocaleString()}`, "Value"]} />
                <Bar
                  dataKey="value"
                  fill="#168b65"
                  radius={[4, 4, 0, 0]}
                  cursor="pointer"
                  onClick={(bar: { stageName: string; opportunityIds: string[] }) =>
                    setDrillDown({ label: bar.stageName, ids: bar.opportunityIds })
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">14-day trend</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data.dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" fontSize={11} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="won" stroke="#168b65" strokeWidth={2} dot={false} name="Won" />
              <Line type="monotone" dataKey="lost" stroke="#e66e58" strokeWidth={2} dot={false} name="Lost" />
              <Line type="monotone" dataKey="newLeads" stroke="#5b5bd6" strokeWidth={2} dot={false} name="New leads" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Lead funnel</h2>
          {funnelData.length === 0 ? (
            <p className="text-sm text-muted">No leads yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={funnelData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" fontSize={12} allowDecimals={false} />
                <YAxis type="category" dataKey="status" fontSize={12} width={90} />
                <Tooltip />
                <Bar dataKey="count" fill="#5b5bd6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">Forecast by category</h2>
          {forecastData.length === 0 ? (
            <p className="text-sm text-muted">No open opportunities yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={forecastData} dataKey="value" nameKey="category" outerRadius={90} label>
                  {forecastData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium text-ink">Forecast by rep</h2>
          {data.byOwner.length === 0 ? (
            <p className="text-sm text-muted">No opportunities assigned yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="pb-2 font-medium">Rep</th>
                    <th className="pb-2 font-medium">Open deals</th>
                    <th className="pb-2 font-medium">Pipeline value</th>
                    <th className="pb-2 font-medium">Weighted forecast</th>
                    <th className="pb-2 font-medium">By category</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byOwner
                    .sort((a, b) => b.weightedForecastMinor - a.weightedForecastMinor)
                    .map((row) => (
                      <tr
                        key={row.ownerId}
                        onClick={() => setDrillDown({ label: row.ownerName, ids: row.opportunityIds })}
                        className="cursor-pointer border-b border-border last:border-0 hover:bg-canvas/40"
                      >
                        <td className="py-2 text-ink">{row.ownerName}</td>
                        <td className="py-2 text-muted">{row.count}</td>
                        <td className="py-2 text-ink">{formatAmount(row.valueMinor)}</td>
                        <td className="py-2 font-medium text-emerald-dark">
                          {formatAmount(row.weightedForecastMinor)}
                        </td>
                        <td className="py-2 text-xs text-muted">
                          {Object.entries(row.forecastByCategory)
                            .map(([category, minor]) => `${category.replace("_", " ")}: ${formatAmount(minor)}`)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {drillDown && (
        <Dialog open onClose={() => setDrillDown(null)} title={drillDown.label}>
          {!allOpportunities ? (
            <Spinner />
          ) : (
            (() => {
              const matches = allOpportunities.filter((o) => drillDown.ids.includes(o.id));
              return matches.length === 0 ? (
                <EmptyState title="No matching deals" description="Nothing found for this selection." />
              ) : (
                <div className="flex flex-col gap-2">
                  {matches.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-4 border-t border-border py-2 text-sm first:border-t-0 first:pt-0">
                      <div>
                        <p className="text-ink">{o.title}</p>
                        <p className="text-xs text-muted">{o.owner?.fullName ?? "Unowned"}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-ink">{formatAmount(o.amountMinor)}</span>
                        <Badge tone={o.status === "WON" ? "success" : o.status === "LOST" ? "danger" : "info"}>
                          {o.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          )}
        </Dialog>
      )}
    </div>
  );
}
