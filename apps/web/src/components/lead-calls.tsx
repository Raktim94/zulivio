"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge, Card, Spinner } from "@/components/ui";
import { CALL_TYPE_TONE, formatDuration, type MobileCallList } from "@/lib/mobile-calls";

/** Phone-call history (from registered mobile devices) for one lead. Hidden when there is none. */
export function LeadCalls({ leadId }: { leadId: string }) {
  const { data, isLoading } = useQuery<MobileCallList>({
    queryKey: ["mobile-calls", "lead", leadId],
    queryFn: () => api.get<MobileCallList>(`/api/v1/mobile/calls?lead_id=${leadId}&limit=20`),
  });

  if (isLoading) return <Spinner />;
  if (!data || data.items.length === 0) return null;

  return (
    <Card>
      <h2 className="mb-3 text-sm font-medium text-ink">
        Call history <span className="text-muted">({data.total})</span>
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {data.items.map((call) => (
          <li key={call.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone={CALL_TYPE_TONE[call.callType]}>{call.callType}</Badge>
              <span className="text-ink">{call.phoneNumber}</span>
            </div>
            <div className="text-xs text-muted">
              {new Date(call.startedAt).toLocaleString()} · {formatDuration(call.durationSeconds)} ·{" "}
              {call.employee.fullName} · {call.device.name}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
