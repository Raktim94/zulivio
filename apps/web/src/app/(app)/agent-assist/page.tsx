"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentAssistResult } from "@zulivio/types";
import { api } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Spinner } from "@/components/ui";

export default function AgentAssistPage() {
  const [form, setForm] = useState({ phone: "", leadId: "", campaign: "" });
  const [query, setQuery] = useState<typeof form | null>(null);

  const { data, isLoading, error } = useQuery<AgentAssistResult>({
    queryKey: ["me", "agent-assist", query],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query?.phone) params.set("phone", query.phone);
      if (query?.leadId) params.set("leadId", query.leadId);
      if (query?.campaign) params.set("campaign", query.campaign);
      return api.get<AgentAssistResult>(`/api/v1/me/agent-assist?${params.toString()}`);
    },
    enabled: query !== null && (Boolean(query.phone) || Boolean(query.leadId)),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Agent Assist</h1>
        <p className="text-sm text-muted">
          Look up a caller and pull real CRM context and knowledge base guidance — no AI, just your own data.
        </p>
      </div>

      <Card>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(form);
          }}
        >
          <Input
            placeholder="Phone number"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Input
            placeholder="Lead ID (optional)"
            value={form.leadId}
            onChange={(e) => setForm({ ...form, leadId: e.target.value })}
          />
          <Input
            placeholder="Campaign (optional)"
            value={form.campaign}
            onChange={(e) => setForm({ ...form, campaign: e.target.value })}
          />
          <div className="sm:col-span-3">
            <Button type="submit" disabled={!form.phone.trim() && !form.leadId.trim()}>
              Look up
            </Button>
          </div>
        </form>
      </Card>

      {isLoading && <Spinner />}
      {error && <ErrorState message="Could not complete that lookup." />}

      {data && (
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-3 text-sm font-medium text-ink">CRM record</h2>
            {data.lead ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-ink">
                  {data.lead.fullName} <Badge tone="info">{data.lead.status}</Badge>
                </p>
                {data.lead.source && <p className="text-muted">Source: {data.lead.source}</p>}
                {data.lead.territory && <p className="text-muted">Territory: {data.lead.territory}</p>}
                {data.lead.nextAllowedStatuses.length > 0 && (
                  <p className="text-muted">
                    Suggested next step: move to{" "}
                    <span className="text-ink">{data.lead.nextAllowedStatuses.join(" or ")}</span>
                  </p>
                )}
              </div>
            ) : (
              <EmptyState title="No matching record" description="Nothing in the CRM matches that number or ID." />
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-medium text-ink">Relevant knowledge</h2>
            {data.knowledgeDocuments.length === 0 && data.tips.length === 0 ? (
              <p className="text-sm text-muted">No matching documents or tips.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {data.knowledgeDocuments.map((d) => (
                  <li key={d.id} className="border-t border-border py-2 first:border-t-0 first:pt-0">
                    <span className="text-ink">{d.title}</span>
                    {d.category && <span className="ml-2 text-xs text-muted">{d.category}</span>}
                  </li>
                ))}
                {data.tips.map((t) => (
                  <li key={t.id} className="border-t border-border py-2 first:border-t-0 first:pt-0">
                    <span className="text-ink">{t.title}</span>
                    <p className="text-xs text-muted">{t.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
