"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssignmentStatus, AssignmentSummary } from "@nodedr-crm/types";
import { api } from "@/lib/api";
import { Badge, Card, EmptyState, ErrorState, Select, Spinner } from "@/components/ui";

const TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  ASSIGNED: ["IN_PROGRESS", "CANCELED"],
  IN_PROGRESS: ["FOLLOW_UP", "BLOCKED", "COMPLETED", "CANCELED"],
  FOLLOW_UP: ["IN_PROGRESS", "COMPLETED", "CANCELED"],
  BLOCKED: ["IN_PROGRESS", "CANCELED"],
  COMPLETED: [],
  CANCELED: [],
};

const TONE: Record<AssignmentStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  ASSIGNED: "info",
  IN_PROGRESS: "info",
  FOLLOW_UP: "warning",
  BLOCKED: "danger",
  COMPLETED: "success",
  CANCELED: "neutral",
};

// The backend scopes the list by role automatically: EMPLOYEE/MANAGER see
// their own + created-by-them assignments, SALES_HEAD and above see the
// whole organization. No client-side filtering needed.
export function AssignmentList() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<AssignmentSummary[]>({
    queryKey: ["assignments"],
    queryFn: () => api.get<AssignmentSummary[]>("/api/v1/assignments"),
  });

  const transition = useMutation({
    mutationFn: ({ id, toStatus }: { id: string; toStatus: AssignmentStatus }) =>
      api.post(`/api/v1/assignments/${id}/transitions`, { toStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboard"] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState message="Could not load assignments." />;
  if (!data || data.length === 0) {
    return <EmptyState title="No assignments" description="Nothing has been assigned yet." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((a) => {
        const options = TRANSITIONS[a.status];
        return (
          <Card key={a.id} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">
                #{a.assignmentNumber} {a.title}
              </p>
              <p className="text-xs text-muted">
                {a.owner ? `${a.owner.fullName} (${a.owner.employeeNumber})` : "Unassigned"}
                {a.dueAt && ` · Due ${new Date(a.dueAt).toLocaleDateString()}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={TONE[a.status]}>{a.status.replace("_", " ")}</Badge>
              {options.length > 0 && (
                <Select
                  className="w-40"
                  defaultValue=""
                  onChange={(e) => {
                    const toStatus = e.target.value as AssignmentStatus;
                    if (toStatus) transition.mutate({ id: a.id, toStatus });
                  }}
                >
                  <option value="" disabled>
                    Move to...
                  </option>
                  {options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
