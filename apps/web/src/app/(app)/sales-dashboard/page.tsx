"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SalesDashboardData } from "@zulivio/types";
import { api } from "@/lib/api";
import { Card, ErrorState, Spinner } from "@/components/ui";

const PIE_COLORS = ["#168b65", "#d99a2b", "#5b5bd6", "#e66e58"];

function formatAmount(minor: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    minor / 100,
  );
}

export default function SalesDashboardPage() {
  const { data, isLoading, error } = useQuery<SalesDashboardData>({
    queryKey: ["reports", "sales-dashboard"],
    queryFn: () => api.get<SalesDashboardData>("/api/v1/reports/sales-dashboard"),
    refetchInterval: 30_000,
  });

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
          {data.stageBreakdown.length === 0 ? (
            <p className="text-sm text-muted">No opportunities yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.stageBreakdown.map((s) => ({ ...s, value: s.valueMinor / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="stageName" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => [`₹${v.toLocaleString()}`, "Value"]} />
                <Bar dataKey="value" fill="#168b65" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
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
                      <tr key={row.ownerId} className="border-b border-border last:border-0">
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
