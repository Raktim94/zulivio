"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Flame, PhoneCall, Plus, Users } from "lucide-react";
import type { LeadScoreConfigSummary, MyDayData, NextLeadData } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Button, Card, EmptyState, ErrorState, Spinner, StatCard, useToast } from "@/components/ui";
import { LeadCard, formatWhen } from "@/components/crm";

const REASON_LABEL: Record<NextLeadData["reason"], string> = {
  overdue_follow_up: "an overdue follow-up",
  scheduled_callback: "a callback due soon",
  hot_lead: "a hot lead",
  new_lead: "a new, untouched lead",
  oldest_untouched: "the lead waiting longest",
  queue_empty: "nothing left in the queue",
};

/**
 * The telecaller's home screen. Its job is to remove every decision except
 * "who do I call next" — which is exactly what the Call Next Lead button
 * answers, using the server's priority order rather than the rep's memory.
 */
export default function MyDayPage() {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState<NextLeadData["reason"] | null>(null);

  const { data, isLoading, error } = useQuery<MyDayData>({
    queryKey: ["leads", "my-day"],
    queryFn: () => api.get<MyDayData>("/api/v1/leads/my-day"),
    refetchInterval: 60_000,
  });

  const { data: scoreConfig } = useQuery<LeadScoreConfigSummary>({
    queryKey: ["leads", "score-config"],
    queryFn: () => api.get<LeadScoreConfigSummary>("/api/v1/leads/score-config"),
  });

  const callNext = useMutation({
    mutationFn: () => api.get<NextLeadData>("/api/v1/leads/next"),
    onSuccess: (result) => {
      setReason(result.reason);
      if (result.lead) router.push(`/leads/${result.lead.id}`);
      else toast.push("Your queue is empty — nice work.", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not pick a lead", "error"),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load your day." />;

  const counts = data.followUps.counts;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">My day</h1>
          <p className="text-sm text-muted">Everything waiting on you right now, in the order to work it.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => callNext.mutate()} disabled={callNext.isPending}>
            <PhoneCall size={15} aria-hidden />
            {callNext.isPending ? "Finding…" : "Call next lead"}
          </Button>
          <Link href="/leads">
            <Button variant="secondary">
              <Plus size={15} aria-hidden /> Add a lead
            </Button>
          </Link>
          <Link href="/follow-ups">
            <Button variant="secondary">
              <CalendarClock size={15} aria-hidden /> Follow-ups
            </Button>
          </Link>
        </div>
      </div>

      {reason && (
        <p className="text-xs text-muted" role="status">
          Last pick was {REASON_LABEL[reason]}.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Calls today" value={data.stats.callsToday} />
        <StatCard label="Connected today" value={data.stats.connectedToday} tone="success" />
        <StatCard label="Overdue follow-ups" value={counts.overdue} tone={counts.overdue > 0 ? "danger" : "neutral"} />
        <StatCard label="Open leads" value={data.stats.openLeads} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
            <PhoneCall size={15} className="text-emerald-dark" aria-hidden /> To contact today
          </h2>
          <p className="mb-3 text-xs text-muted">Never contacted, or due for a follow-up before the day is out.</p>
          {data.toContact.length === 0 ? (
            <EmptyState title="Nothing waiting" description="Every lead in your queue has been worked today." />
          ) : (
            <div className="flex flex-col gap-2">
              {data.toContact.slice(0, 8).map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  hotThreshold={scoreConfig?.hotThreshold}
                  warmThreshold={scoreConfig?.warmThreshold}
                />
              ))}
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
              <Flame size={15} className="text-coral" aria-hidden /> Hot leads
            </h2>
            <p className="mb-3 text-xs text-muted">
              Score at or above {scoreConfig?.hotThreshold ?? 80}.
            </p>
            {data.hotLeads.length === 0 ? (
              <p className="text-sm text-muted">No hot leads yet — qualify a few more calls.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.hotLeads.slice(0, 5).map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    hotThreshold={scoreConfig?.hotThreshold}
                    warmThreshold={scoreConfig?.warmThreshold}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-ink">
              <Users size={15} className="text-indigo" aria-hidden /> Recently assigned
            </h2>
            <p className="mb-3 text-xs text-muted">Landed in your queue in the last 48 hours.</p>
            {data.recentlyAssigned.length === 0 ? (
              <p className="text-sm text-muted">Nothing new.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.recentlyAssigned.slice(0, 6).map((lead) => (
                  <li key={lead.id} className="flex items-center justify-between gap-2 text-sm">
                    <Link href={`/leads/${lead.id}`} className="truncate text-ink hover:text-emerald-dark hover:underline">
                      {lead.fullName}
                      {lead.company && <span className="text-muted"> · {lead.company}</span>}
                    </Link>
                    <span className="shrink-0 text-xs text-muted">{formatWhen(lead.createdAt).label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
