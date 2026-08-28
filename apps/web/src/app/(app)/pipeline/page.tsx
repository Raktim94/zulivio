"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmployeeSummary, OpportunitySummary, PipelineSummary } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorState, Input, Select, Spinner } from "@/components/ui";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";

function formatAmount(minor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );
}

export default function PipelinePage() {
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const managerView = isManagerOrAbove(employee?.role);

  const { data: pipelines, isLoading: pipelinesLoading } = useQuery<PipelineSummary[]>({
    queryKey: ["pipelines"],
    queryFn: () => api.get<PipelineSummary[]>("/api/v1/pipelines"),
  });
  const { data: opportunities, isLoading, error } = useQuery<OpportunitySummary[]>({
    queryKey: ["opportunities"],
    queryFn: () => api.get<OpportunitySummary[]>("/api/v1/opportunities"),
  });
  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
    enabled: managerView,
  });

  const [form, setForm] = useState({ title: "", company: "", amount: "", ownerId: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [lossReasonFor, setLossReasonFor] = useState<{ opportunityId: string; stageId: string } | null>(null);
  const [lossReason, setLossReason] = useState("");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["reports", "sales-dashboard"] });
  }

  const createOpportunity = useMutation({
    mutationFn: () =>
      api.post("/api/v1/opportunities", {
        title: form.title,
        company: form.company || undefined,
        amountMinor: form.amount ? Math.round(parseFloat(form.amount) * 100) : undefined,
        ownerId: form.ownerId || undefined,
      }),
    onSuccess: () => {
      setForm({ title: "", company: "", amount: "", ownerId: "" });
      invalidate();
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not create opportunity"),
  });

  const moveStage = useMutation({
    mutationFn: ({ id, stageId, reason }: { id: string; stageId: string; reason?: string }) =>
      api.post(`/api/v1/opportunities/${id}/stage-transitions`, { stageId, lossReason: reason }),
    onSuccess: invalidate,
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not move opportunity"),
  });

  const pipeline = pipelines?.[0];

  if (pipelinesLoading || isLoading) return <Spinner />;
  if (error || !pipeline) return <ErrorState message="Could not load the pipeline." />;

  const openOpportunities = (opportunities ?? []).filter((o) => o.status === "OPEN");
  const totalOpen = openOpportunities.reduce((sum, o) => sum + o.amountMinor, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Pipeline</h1>
        <p className="text-sm text-muted">
          {openOpportunities.length} open opportunities · {formatAmount(totalOpen, "INR")} total value
        </p>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">New opportunity</h2>
        {formError && <div className="mb-3"><ErrorState message={formError} /></div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            createOpportunity.mutate();
          }}
          className="grid grid-cols-1 gap-3 md:grid-cols-4"
        >
          <Input
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <Input
            placeholder="Company (optional)"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="Amount (₹)"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          {managerView && employees ? (
            <Select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
              <option value="">Me</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.employeeNumber} — {emp.fullName}
                </option>
              ))}
            </Select>
          ) : (
            <div />
          )}
          <div className="md:col-span-4">
            <Button type="submit" disabled={createOpportunity.isPending}>
              {createOpportunity.isPending ? "Creating..." : "Create opportunity"}
            </Button>
          </div>
        </form>
      </Card>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-4" style={{ minWidth: `${pipeline.stages.length * 260}px` }}>
          {pipeline.stages.map((stage) => {
            const cards = openOpportunities.filter((o) => o.stageId === stage.id);
            const stageValue = cards.reduce((sum, o) => sum + o.amountMinor, 0);

            return (
              <div key={stage.id} className="flex w-64 shrink-0 flex-col gap-3">
                <div className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 shadow-sm">
                  <span className="text-sm font-medium text-ink">{stage.name}</span>
                  <span className="text-xs text-muted">{cards.length}</span>
                </div>
                <p className="-mt-2 text-xs text-muted">{formatAmount(stageValue, "INR")}</p>

                {cards.map((opp) => (
                  <Card key={opp.id} className="p-3">
                    {opp.leadId ? (
                      <Link
                        href={`/leads/${opp.leadId}`}
                        className="text-sm font-medium text-ink hover:text-emerald-dark hover:underline"
                      >
                        {opp.title}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-ink">{opp.title}</p>
                    )}
                    {opp.company && <p className="text-xs text-muted">{opp.company}</p>}
                    <p className="mt-1 text-sm font-semibold text-emerald-dark">
                      {formatAmount(opp.amountMinor, opp.currency)}
                    </p>
                    <p className="mt-1 text-xs text-muted">{opp.owner?.fullName ?? "Unassigned"}</p>
                    {opp.leadId && (
                      <Link href={`/leads/${opp.leadId}`}>
                        <Button variant="secondary" className="mt-2 w-full py-1 text-xs">
                          View lead & follow-up
                        </Button>
                      </Link>
                    )}
                    <Select
                      className="mt-2 py-1 text-xs"
                      defaultValue=""
                      onChange={(e) => {
                        const targetStageId = e.target.value;
                        if (!targetStageId) return;
                        const target = pipeline.stages.find((s) => s.id === targetStageId);
                        if (target?.isLost) {
                          setLossReasonFor({ opportunityId: opp.id, stageId: targetStageId });
                        } else {
                          moveStage.mutate({ id: opp.id, stageId: targetStageId });
                        }
                      }}
                    >
                      <option value="" disabled>
                        Move to...
                      </option>
                      {pipeline.stages
                        .filter((s) => s.id !== stage.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </Select>
                  </Card>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {lossReasonFor && (
        <Card>
          <h2 className="mb-2 text-sm font-medium text-ink">Why was this lost?</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              moveStage.mutate({ id: lossReasonFor.opportunityId, stageId: lossReasonFor.stageId, reason: lossReason });
              setLossReasonFor(null);
              setLossReason("");
            }}
            className="flex flex-wrap items-center gap-3"
          >
            <Input
              className="w-72"
              placeholder="Loss reason (required)"
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value)}
              required
            />
            <Button type="submit">Confirm loss</Button>
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() => {
                setLossReasonFor(null);
                setLossReason("");
              }}
            >
              Cancel
            </button>
          </form>
        </Card>
      )}
    </div>
  );
}
