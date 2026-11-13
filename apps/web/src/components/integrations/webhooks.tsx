"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Skeleton, useToast } from "@/components/ui";
import { ConfirmDialog, Field, SecretOnceDialog, STATUS_LABEL, statusTone, when, type Catalog } from "./shared";

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  status: "active" | "paused";
  secretPreview: string;
  secretRotatedAt: string;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastSuccessAt: string | null;
}

interface Delivery {
  id: string;
  eventId: string;
  eventType: string;
  status: "success" | "pending" | "failed";
  attempts: number;
  statusCode: number | null;
  error: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  isTest: boolean;
  createdAt: string;
}

export function WebhooksPanel({ catalog }: { catalog: Catalog | undefined }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data, isLoading, error } = useQuery<Webhook[]>({ queryKey: ["integrations", "webhooks"], queryFn: () => api.get("/api/v1/integrations/webhooks") });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", events: [] as string[] });
  const [formError, setFormError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [history, setHistory] = useState<Webhook | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "revoke" | "rotate"; w: Webhook } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });
  const fail = (e: unknown) => push(e instanceof ApiError ? e.message : "That didn't work", "error");

  const create = useMutation({
    mutationFn: () => api.post<{ secret: string }>("/api/v1/integrations/webhooks", form),
    onSuccess: (r) => { setSecret(r.secret); setCreating(false); setForm({ name: "", url: "", events: [] }); setFormError(null); void refresh(); },
    onError: (e) => setFormError(e instanceof ApiError ? e.message : "Could not create the webhook"),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" }) => api.patch(`/api/v1/integrations/webhooks/${id}`, { status }),
    onSuccess: () => void refresh(), onError: fail,
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post<Delivery>(`/api/v1/integrations/webhooks/${id}/test`),
    onSuccess: (d) => { push(d.status === "success" ? `Test delivered (HTTP ${d.statusCode})` : `Test failed: ${d.error ?? "no response"}`, d.status === "success" ? "success" : "error"); void refresh(); },
    onError: fail,
  });
  const act = useMutation({
    mutationFn: async ({ kind, w }: { kind: "revoke" | "rotate"; w: Webhook }) =>
      kind === "revoke" ? api.delete(`/api/v1/integrations/webhooks/${w.id}`) : api.post<{ secret: string }>(`/api/v1/integrations/webhooks/${w.id}/rotate-secret`),
    onSuccess: (r, v) => { setConfirm(null); if (v.kind === "rotate") setSecret((r as { secret: string }).secret); else push("Webhook revoked.", "success"); void refresh(); },
    onError: (e) => { setConfirm(null); fail(e); },
  });

  const allEvents = form.events.includes("*");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-ink">Webhooks</h2>
            <p className="mt-1 text-sm text-muted">
              Zulivio sends a signed JSON event to your HTTPS address when something happens. Each delivery carries a stable event id and an HMAC signature you verify with the endpoint's secret;
              failures are retried with backoff and recorded in the history.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>Add webhook</Button>
        </div>
      </Card>

      {isLoading ? <Skeleton className="h-24" /> : error ? (
        <ErrorState message={error instanceof ApiError && error.status === 403 ? "Only a Company Admin or Master Owner can manage webhooks." : "Couldn't load webhooks."} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No webhooks yet" description="Add an endpoint to be told about new leads, stage changes, calls and follow-ups as they happen." />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((w) => (
            <li key={w.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{w.name}</p>
                  <p className="break-all font-mono text-xs text-muted">{w.url}</p>
                  <p className="mt-2 flex flex-wrap gap-1">{w.events.map((e) => <Badge key={e} tone="info">{e === "*" ? "all events" : e}</Badge>)}</p>
                  <p className="mt-2 text-xs text-muted">
                    Secret {w.secretPreview} · Last delivery {when(w.lastDeliveryAt)} · Last success {when(w.lastSuccessAt)}
                  </p>
                  {w.status === "paused" && w.consecutiveFailures >= 10 && (
                    <p className="mt-2 text-xs text-amber">Paused automatically after repeated failures. Fix the endpoint, then resume.</p>
                  )}
                </div>
                <Badge tone={statusTone(w.status)}>{STATUS_LABEL[w.status] ?? w.status}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={test.isPending} onClick={() => test.mutate(w.id)}>Send test</Button>
                <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setHistory(w)}>Delivery history</Button>
                <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setStatus.mutate({ id: w.id, status: w.status === "active" ? "paused" : "active" })}>
                  {w.status === "active" ? "Pause" : "Resume"}
                </Button>
                <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setConfirm({ kind: "rotate", w })}>Rotate secret</Button>
                <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => setConfirm({ kind: "revoke", w })}>Revoke</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Add webhook">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setFormError(null); create.mutate(); }}>
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} /></Field>
          <Field label="Endpoint URL" hint="Must be https:// and publicly reachable. Private and local network addresses are refused.">
            <Input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required placeholder="https://example.com/zulivio-webhook" />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink">Events</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={allEvents} onChange={(e) => setForm({ ...form, events: e.target.checked ? ["*"] : [] })} />
              <span>All events (including ones added in future versions)</span>
            </label>
            {!allEvents && (catalog?.events ?? []).map((ev) => (
              <label key={ev.type} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={form.events.includes(ev.type)} onChange={(e) => setForm({ ...form, events: e.target.checked ? [...form.events, ev.type] : form.events.filter((x) => x !== ev.type) })} />
                <span><span className="font-mono text-xs">{ev.type}</span> — {ev.description}</span>
              </label>
            ))}
          </fieldset>
          {formError && <ErrorState message={formError} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || form.events.length === 0 || !form.name.trim() || !form.url.trim()}>{create.isPending ? "Adding…" : "Add webhook"}</Button>
          </div>
        </form>
      </Dialog>

      <SecretOnceDialog
        secret={secret}
        title="Your webhook signing secret"
        onClose={() => setSecret(null)}
        note={<p className="text-xs text-muted">Verify each delivery: <code>HMAC-SHA256(secret, timestamp + "." + rawBody)</code> must equal the <code>v1</code> value in the <code>X-Zulivio-Signature</code> header, and the timestamp should be within 5 minutes.</p>}
      />
      <HistoryDialog webhook={history} onClose={() => setHistory(null)} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "revoke" ? `Revoke “${confirm.w.name}”?` : `Rotate the secret for “${confirm?.w.name}”?`}
        confirmLabel={confirm?.kind === "revoke" ? "Revoke now" : "Rotate now"}
        pending={act.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm)}
      >
        {confirm?.kind === "revoke"
          ? "Deliveries stop immediately and anything still queued for this endpoint is cancelled."
          : "The next delivery is signed with a new secret and the old one no longer verifies. Update your receiver right away."}
      </ConfirmDialog>
    </div>
  );
}

function HistoryDialog({ webhook, onClose }: { webhook: Webhook | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data, isLoading, error } = useQuery<{ data: Delivery[]; nextCursor: string | null }>({
    queryKey: ["integrations", "deliveries", webhook?.id],
    queryFn: () => api.get(`/api/v1/integrations/webhooks/${webhook!.id}/deliveries?limit=50`),
    enabled: webhook !== null,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/integrations/webhook-deliveries/${id}/retry`),
    onSuccess: () => { push("Queued for another attempt.", "success"); void qc.invalidateQueries({ queryKey: ["integrations", "deliveries"] }); },
    onError: (e) => push(e instanceof ApiError ? e.message : "Couldn't retry", "error"),
  });
  return (
    <Dialog open={webhook !== null} onClose={onClose} title={webhook ? `Deliveries · ${webhook.name}` : "Deliveries"} className="max-w-2xl">
      {isLoading ? <Skeleton className="h-24" /> : error ? <ErrorState message="Couldn't load the history." /> : !data || data.data.length === 0 ? (
        <EmptyState title="Nothing delivered yet" description="Use “Send test”, or wait for a matching event." />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.data.map((d) => (
            <li key={d.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-xs text-ink">{d.eventType}{d.isTest ? " (test)" : ""}</p>
                <Badge tone={statusTone(d.status)}>{STATUS_LABEL[d.status] ?? d.status}</Badge>
              </div>
              <p className="mt-1 break-all font-mono text-[11px] text-muted">{d.eventId}</p>
              <p className="mt-1 text-xs text-muted">
                {d.attempts} attempt{d.attempts === 1 ? "" : "s"}{d.statusCode ? ` · HTTP ${d.statusCode}` : ""}{d.error ? ` · ${d.error}` : ""} · {when(d.lastAttemptAt ?? d.createdAt)}
                {d.nextAttemptAt && ` · next try ${when(d.nextAttemptAt)}`}
              </p>
              {d.status !== "success" && (
                <Button variant="secondary" className="mt-2 px-3 py-1 text-xs" disabled={retry.isPending} onClick={() => retry.mutate(d.id)}>Retry now</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
