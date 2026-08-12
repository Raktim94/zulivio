"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TipFeedItem, TrainingFeedItem } from "@zulivio/types";
import { api } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";

export function TipsFeed() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<TipFeedItem[]>({
    queryKey: ["tips", "feed"],
    queryFn: () => api.get<TipFeedItem[]>("/api/v1/tips/feed"),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/tips/${id}/acknowledge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tips", "feed"] }),
  });

  if (isLoading) return <Spinner />;

  return (
    <Card>
      <h2 className="mb-3 text-sm font-medium text-ink">Today&apos;s tips</h2>
      {!data || data.length === 0 ? (
        <p className="text-sm text-muted">No tips published yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((tip) => (
            <li key={tip.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
              <p className="text-sm font-medium text-ink">{tip.title}</p>
              <p className="mt-0.5 text-sm text-muted">{tip.body}</p>
              <div className="mt-2 flex items-center gap-2">
                {tip.acknowledged ? (
                  <Badge tone="success">Acknowledged</Badge>
                ) : (
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => acknowledge.mutate(tip.id)}
                  >
                    Mark helpful
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TrainingFeed() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<TrainingFeedItem[]>({
    queryKey: ["training", "me"],
    queryFn: () => api.get<TrainingFeedItem[]>("/api/v1/knowledge/training-assignments/me"),
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/knowledge/training-assignments/${id}/acknowledge`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["training", "me"] }),
  });

  if (isLoading) return <Spinner />;

  return (
    <Card>
      <h2 className="mb-3 text-sm font-medium text-ink">Required training</h2>
      {!data || data.length === 0 ? (
        <p className="text-sm text-muted">Nothing assigned right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((t) => (
            <li key={t.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-ink">{t.document.title}</p>
                {t.dueAt && <p className="text-xs text-muted">Due {new Date(t.dueAt).toLocaleDateString()}</p>}
              </div>
              {t.acknowledgedAt ? (
                <Badge tone="success">Acknowledged</Badge>
              ) : (
                <Button
                  variant="secondary"
                  className="px-2 py-1 text-xs"
                  onClick={() => acknowledge.mutate(t.id)}
                >
                  Acknowledge
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
