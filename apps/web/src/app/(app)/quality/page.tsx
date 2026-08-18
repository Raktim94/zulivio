"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmployeeSummary, QualityAuditDefinitionSummary, QualityAuditResultSummary } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Input,
  Select,
  Skeleton,
  Spinner,
  useToast,
} from "@/components/ui";

// Definitions ship with a single "Overall" scoring section, auto-created
// when a manager names a new definition — a full per-section/per-criterion
// form builder is a separate, larger UI effort; the backend already
// supports it (arbitrary JSON), this UI is a deliberately simpler MVP on
// top of it.
const DEFAULT_SECTIONS = [{ id: "overall", name: "Overall", maxScore: 10, criteria: [{ id: "overall", label: "Overall quality", maxScore: 10 }] }];

export default function QualityPage() {
  const { data: employee } = useCurrentEmployee();
  const manager = isManagerOrAbove(employee?.role);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Quality Audits</h1>
        <p className="text-sm text-muted">
          {manager ? "Score your team and review published feedback." : "Feedback from your reviewer, once published."}
        </p>
      </div>
      <MyResults />
      {manager && <ReviewerPanel />}
    </div>
  );
}

function ScoreDetail({ result, onClose }: { result: QualityAuditResultSummary; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const acknowledge = useMutation({
    mutationFn: () => api.post(`/api/v1/quality-audits/results/${result.id}/acknowledge`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "quality-audits"] });
      push("Acknowledged.", "success");
      onClose();
    },
  });

  return (
    <Dialog open onClose={onClose} title={result.definition.name}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">Reviewed by {result.reviewer.fullName}</span>
          <Badge tone="success">Score: {result.overallScore}</Badge>
        </div>
        {result.feedback && <p className="text-ink">{result.feedback}</p>}
        <p className="text-xs text-muted">{new Date(result.createdAt).toLocaleString()}</p>
        {!result.acknowledgedAt ? (
          <Button onClick={() => acknowledge.mutate()} disabled={acknowledge.isPending}>
            {acknowledge.isPending ? "Acknowledging..." : "Acknowledge"}
          </Button>
        ) : (
          <p className="text-xs text-emerald-dark">Acknowledged {new Date(result.acknowledgedAt).toLocaleString()}</p>
        )}
      </div>
    </Dialog>
  );
}

function MyResults() {
  const [selected, setSelected] = useState<QualityAuditResultSummary | null>(null);
  const { data, isLoading, error } = useQuery<QualityAuditResultSummary[]>({
    queryKey: ["me", "quality-audits"],
    queryFn: () => api.get<QualityAuditResultSummary[]>("/api/v1/me/quality-audits"),
  });

  if (isLoading) return <Skeleton className="h-32" />;
  if (error || !data) return <ErrorState message="Could not load your quality audits." />;
  if (data.length === 0) {
    return <EmptyState title="No feedback yet" description="Published reviews from your reviewer will appear here." />;
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {data.map((r) => (
          <Card
            key={r.id}
            className="flex cursor-pointer items-center justify-between gap-4"
            onClick={() => setSelected(r)}
          >
            <div>
              <p className="text-sm font-medium text-ink">{r.definition.name}</p>
              <p className="text-xs text-muted">Reviewed by {r.reviewer.fullName}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="success">{r.overallScore}</Badge>
              {!r.acknowledgedAt && <Badge tone="warning">Needs acknowledgement</Badge>}
            </div>
          </Card>
        ))}
      </div>
      {selected && <ScoreDetail result={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function ReviewerPanel() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [scoreDialogOpen, setScoreDialogOpen] = useState(false);
  const [newDefName, setNewDefName] = useState("");
  const [showNewDef, setShowNewDef] = useState(false);
  const [form, setForm] = useState({ definitionId: "", employeeId: "", overallScore: "8", feedback: "" });
  const [error, setError] = useState<string | null>(null);

  const { data: definitions } = useQuery<QualityAuditDefinitionSummary[]>({
    queryKey: ["quality-audits", "definitions"],
    queryFn: () => api.get<QualityAuditDefinitionSummary[]>("/api/v1/quality-audits/definitions"),
  });
  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
  });
  const { data: results, isLoading: resultsLoading } = useQuery<QualityAuditResultSummary[]>({
    queryKey: ["quality-audits", "results"],
    queryFn: () => api.get<QualityAuditResultSummary[]>("/api/v1/quality-audits/results"),
  });

  const createDefinition = useMutation({
    mutationFn: () => api.post("/api/v1/quality-audits/definitions", { name: newDefName, sections: DEFAULT_SECTIONS }),
    onSuccess: () => {
      setNewDefName("");
      setShowNewDef(false);
      queryClient.invalidateQueries({ queryKey: ["quality-audits", "definitions"] });
    },
  });

  const createResult = useMutation({
    mutationFn: () => {
      const score = Number(form.overallScore);
      return api.post("/api/v1/quality-audits/results", {
        definitionId: form.definitionId,
        employeeId: form.employeeId,
        overallScore: score,
        sectionScores: [{ sectionId: "overall", score, criteria: [{ criteriaId: "overall", score }] }],
        feedback: form.feedback || undefined,
      });
    },
    onSuccess: () => {
      setError(null);
      setScoreDialogOpen(false);
      setForm({ definitionId: "", employeeId: "", overallScore: "8", feedback: "" });
      queryClient.invalidateQueries({ queryKey: ["quality-audits", "results"] });
      push("Draft saved. Publish it when ready.", "success");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save this score"),
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/quality-audits/results/${id}/publish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quality-audits", "results"] });
      push("Published — the employee can now see it.", "success");
    },
  });

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Team reviews</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowNewDef(true)}>
            New definition
          </Button>
          <Button onClick={() => setScoreDialogOpen(true)} disabled={!definitions || definitions.length === 0}>
            Score someone
          </Button>
        </div>
      </div>

      {resultsLoading ? (
        <Spinner />
      ) : !results || results.length === 0 ? (
        <EmptyState title="No reviews yet" description="Score a team member to get started." />
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0 first:pt-0">
              <span>
                <span className="text-ink">{r.employee?.fullName}</span>{" "}
                <span className="text-muted">
                  · {r.definition.name} · {r.overallScore}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <Badge tone={r.status === "PUBLISHED" ? "success" : "neutral"}>{r.status}</Badge>
                {r.status === "DRAFT" && (
                  <Button
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => publish.mutate(r.id)}
                    disabled={publish.isPending}
                  >
                    Publish
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={showNewDef} onClose={() => setShowNewDef(false)} title="New definition">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            createDefinition.mutate();
          }}
        >
          <Input
            placeholder="e.g. Call Quality"
            value={newDefName}
            onChange={(e) => setNewDefName(e.target.value)}
            required
          />
          <Button type="submit" disabled={createDefinition.isPending || !newDefName.trim()}>
            {createDefinition.isPending ? "Creating..." : "Create"}
          </Button>
        </form>
      </Dialog>

      <Dialog open={scoreDialogOpen} onClose={() => setScoreDialogOpen(false)} title="Score a team member">
        {error && <ErrorState message={error} />}
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            createResult.mutate();
          }}
        >
          <Select
            value={form.definitionId}
            onChange={(e) => setForm({ ...form, definitionId: e.target.value })}
            required
          >
            <option value="">Definition...</option>
            {definitions?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} required>
            <option value="">Employee...</option>
            {employees?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={0}
            max={10}
            value={form.overallScore}
            onChange={(e) => setForm({ ...form, overallScore: e.target.value })}
            required
          />
          <Input
            placeholder="Feedback (optional)"
            value={form.feedback}
            onChange={(e) => setForm({ ...form, feedback: e.target.value })}
          />
          <Button type="submit" disabled={createResult.isPending}>
            {createResult.isPending ? "Saving..." : "Save as draft"}
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}
