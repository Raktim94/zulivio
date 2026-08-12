"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WorkSessionStatus } from "@zulivio/types";
import { api } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";

export function AttendanceWidget() {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useQuery<WorkSessionStatus>({
    queryKey: ["work-sessions", "me"],
    queryFn: () => api.get<WorkSessionStatus>("/api/v1/work-sessions/me"),
    refetchInterval: 15_000,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["work-sessions", "me"] });
    queryClient.invalidateQueries({ queryKey: ["reports", "dashboard"] });
  }

  const startSession = useMutation({
    mutationFn: () => api.post("/api/v1/work-sessions/start"),
    onSuccess: invalidate,
  });
  const endSession = useMutation({
    mutationFn: () => api.post(`/api/v1/work-sessions/${status?.sessionId}/end`),
    onSuccess: invalidate,
  });
  const startBreak = useMutation({
    mutationFn: () => api.post(`/api/v1/work-sessions/${status?.sessionId}/breaks/start`),
    onSuccess: invalidate,
  });
  const endBreak = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/work-sessions/${status?.sessionId}/breaks/${status?.currentBreakId}/end`),
    onSuccess: invalidate,
  });

  if (isLoading || !status) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-ink">Your shift</h2>
          <div className="mt-1">
            <Badge tone={status.state === "working" ? "success" : status.state === "on_break" ? "warning" : "neutral"}>
              {status.state === "logged_out" ? "Not clocked in" : status.state === "working" ? "Working" : "On break"}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {status.state === "logged_out" && (
            <Button onClick={() => startSession.mutate()} disabled={startSession.isPending}>
              Start shift
            </Button>
          )}
          {status.state === "working" && (
            <>
              <Button variant="secondary" onClick={() => startBreak.mutate()} disabled={startBreak.isPending}>
                Start break
              </Button>
              <Button variant="danger" onClick={() => endSession.mutate()} disabled={endSession.isPending}>
                End shift
              </Button>
            </>
          )}
          {status.state === "on_break" && (
            <>
              <Button onClick={() => endBreak.mutate()} disabled={endBreak.isPending}>
                Resume work
              </Button>
              <Button variant="danger" onClick={() => endSession.mutate()} disabled={endSession.isPending}>
                End shift
              </Button>
            </>
          )}
        </div>
      </div>
      {status.startedAt && (
        <p className="mt-3 text-xs text-muted">
          Started {new Date(status.startedAt).toLocaleTimeString()}
        </p>
      )}
    </Card>
  );
}
