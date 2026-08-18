"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkflowDefinitionSummary, WorkflowRunSummary } from "@zulivio/types";
import { api } from "@/lib/api";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";
import { Badge, Button, Card, Dialog, EmptyState, Input, Skeleton, useToast } from "@/components/ui";

export default function HelpdeskPage() {
  const { data: employee } = useCurrentEmployee();
  const manager = isManagerOrAbove(employee?.role);
  const queryClient = useQueryClient();
  const { push } = useToast();

  const { data: definitions, isLoading } = useQuery<WorkflowDefinitionSummary[]>({
    queryKey: ["workflows", "definitions"],
    queryFn: () => api.get<WorkflowDefinitionSummary[]>("/api/v1/workflows/definitions"),
  });
  const { data: myRuns } = useQuery<WorkflowRunSummary[]>({
    queryKey: ["me", "tasks"],
    queryFn: () => api.get<{ workflowRuns: WorkflowRunSummary[] }>("/api/v1/me/tasks").then((d) => d.workflowRuns),
  });

  const activeRun = myRuns?.find((r) => r.status === "IN_PROGRESS");
  const activeDefinition = definitions?.find((d) => d.id === activeRun?.workflowDefinitionId);

  const startRun = useMutation({
    mutationFn: (definitionId: string) => api.post(`/api/v1/workflows/definitions/${definitionId}/runs`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "tasks"] }),
  });

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/workflows/definitions/${id}/publish`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows", "definitions"] });
      push("Published — employees can now run it.", "success");
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Helpdesk</h1>
        <p className="text-sm text-muted">Guided, step-by-step runbooks for common procedures.</p>
      </div>

      {activeRun && activeDefinition ? (
        <RunnerCard run={activeRun} definition={activeDefinition} />
      ) : isLoading ? (
        <Skeleton className="h-32" />
      ) : !definitions || definitions.filter((d) => d.status === "PUBLISHED").length === 0 ? (
        <EmptyState title="No workflows published yet" description="Ask a manager to publish one." />
      ) : (
        <div className="flex flex-col gap-3">
          {definitions
            .filter((d) => d.status === "PUBLISHED")
            .map((d) => (
              <Card key={d.id} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-ink">{d.name}</p>
                  {d.description && <p className="text-xs text-muted">{d.description}</p>}
                </div>
                <Button onClick={() => startRun.mutate(d.id)} disabled={startRun.isPending}>
                  Start
                </Button>
              </Card>
            ))}
        </div>
      )}

      {manager && <AuthorPanel definitions={definitions} onPublish={(id) => publish.mutate(id)} />}
    </div>
  );
}

function RunnerCard({ run, definition }: { run: WorkflowRunSummary; definition: WorkflowDefinitionSummary }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const step = definition.steps[run.currentStepIndex];
  const isLastStep = run.currentStepIndex >= definition.steps.length - 1;

  const advance = useMutation({
    mutationFn: () => api.patch(`/api/v1/workflows/runs/${run.id}`, { currentStepIndex: run.currentStepIndex + 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me", "tasks"] }),
  });
  const complete = useMutation({
    mutationFn: () => api.post(`/api/v1/workflows/runs/${run.id}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me", "tasks"] });
      push("Workflow completed.", "success");
    },
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">{definition.name}</h2>
        <Badge tone="info">
          Step {run.currentStepIndex + 1} of {definition.steps.length}
        </Badge>
      </div>
      {step ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-ink">{step.title}</p>
          {step.body && <p className="text-sm text-muted">{step.body}</p>}
          {isLastStep ? (
            <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
              {complete.isPending ? "Completing..." : "Complete"}
            </Button>
          ) : (
            <Button onClick={() => advance.mutate()} disabled={advance.isPending}>
              {advance.isPending ? "Saving..." : "Next step"}
            </Button>
          )}
        </div>
      ) : (
        <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
          Complete
        </Button>
      )}
    </Card>
  );
}

function AuthorPanel({
  definitions,
  onPublish,
}: {
  definitions: WorkflowDefinitionSummary[] | undefined;
  onPublish: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<{ id: string; title: string; body: string }[]>([]);
  const [stepDraft, setStepDraft] = useState({ title: "", body: "" });

  const createDefinition = useMutation({
    mutationFn: () =>
      api.post("/api/v1/workflows/definitions", {
        name,
        description: description || undefined,
        steps: steps.map(({ id, title, body }) => ({ id, title, body })),
      }),
    onSuccess: () => {
      setOpen(false);
      setName("");
      setDescription("");
      setSteps([]);
      queryClient.invalidateQueries({ queryKey: ["workflows", "definitions"] });
    },
  });

  const drafts = definitions?.filter((d) => d.status === "DRAFT") ?? [];

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">Author workflows</h2>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          New workflow
        </Button>
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted">No drafts waiting to be published.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {drafts.map((d) => (
            <li key={d.id} className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0 first:pt-0">
              <span className="text-ink">
                {d.name} <span className="text-muted">· {d.steps.length} steps</span>
              </span>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onPublish(d.id)}>
                Publish
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="New workflow">
        <div className="flex flex-col gap-3">
          <Input placeholder="Workflow name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted">Steps ({steps.length})</p>
            {steps.length > 0 && (
              <ol className="mb-3 flex flex-col gap-1 text-sm">
                {steps.map((s, i) => (
                  <li key={s.id} className="text-ink">
                    {i + 1}. {s.title}
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-col gap-2">
              <Input
                placeholder="Step title"
                value={stepDraft.title}
                onChange={(e) => setStepDraft({ ...stepDraft, title: e.target.value })}
              />
              <Input
                placeholder="Step instructions (optional)"
                value={stepDraft.body}
                onChange={(e) => setStepDraft({ ...stepDraft, body: e.target.value })}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!stepDraft.title.trim()}
                onClick={() => {
                  setSteps([...steps, { id: crypto.randomUUID(), ...stepDraft }]);
                  setStepDraft({ title: "", body: "" });
                }}
              >
                Add step
              </Button>
            </div>
          </div>

          <Button
            onClick={() => createDefinition.mutate()}
            disabled={createDefinition.isPending || !name.trim() || steps.length === 0}
          >
            {createDefinition.isPending ? "Creating..." : "Create draft"}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
