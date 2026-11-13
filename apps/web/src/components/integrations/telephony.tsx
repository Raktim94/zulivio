"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Select, Skeleton, useToast } from "@/components/ui";
import { ConfirmDialog, CopyButton, Field, SecretOnceDialog, when, type Catalog } from "./shared";

interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  auth: "hmac" | "token";
  fields: Record<string, string>;
  statusMap: Record<string, string>;
  secretPreview: string;
  eventUrlPath: string;
  delivery: { eventsReceived: number; eventsRejected: number; lastEventAt: string | null; lastErrorAt: string | null; lastError: string | null; lastTestAt: string | null };
}

interface TestResult {
  ok: boolean;
  error?: string;
  normalized?: Record<string, unknown>;
  sample?: Record<string, unknown>;
  signing: { header: string; format: string; toleranceSeconds: number; alternative: string | null };
}

const FIELD_HELP: Record<string, string> = {
  providerCallId: "Unique call id",
  eventType: "Event / status word",
  direction: "inbound / outbound",
  customerPhone: "Customer's number",
  customerPhoneInbound: "Customer number when inbound (optional)",
  customerPhoneOutbound: "Customer number when outbound (optional)",
  startedAt: "Start time",
  answeredAt: "Answer time",
  endedAt: "End time",
  duration: "Duration in seconds",
  agentEmail: "Agent's email (matches an employee)",
};

/** Business-phone-system adapter. Only a provider that can POST JSON webhooks is supported; there is no per-vendor integration. */
export function TelephonyPanel({ catalog }: { catalog: Catalog | undefined }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data, isLoading, error } = useQuery<Provider[]>({ queryKey: ["integrations", "telephony"], queryFn: () => api.get("/api/v1/integrations/telephony") });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [auth, setAuth] = useState<"hmac" | "token">("hmac");
  const [secret, setSecret] = useState<{ value: string; path: string } | null>(null);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [testing, setTesting] = useState<{ p: Provider; r: TestResult } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "delete" | "rotate"; p: Provider } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });
  const fail = (e: unknown) => push(e instanceof ApiError ? e.message : "That didn't work", "error");

  const create = useMutation({
    mutationFn: () => api.post<{ secret: string; eventUrlPath: string }>("/api/v1/integrations/telephony", { name, auth }),
    onSuccess: (r) => { setSecret({ value: r.secret, path: r.eventUrlPath }); setCreating(false); setName(""); void refresh(); },
    onError: fail,
  });
  const toggle = useMutation({ mutationFn: (p: Provider) => api.patch(`/api/v1/integrations/telephony/${p.id}`, { enabled: !p.enabled }), onSuccess: () => void refresh(), onError: fail });
  const runTest = useMutation({
    mutationFn: (p: Provider) => api.post<TestResult>(`/api/v1/integrations/telephony/${p.id}/test`, {}),
    onSuccess: (r, p) => { setTesting({ p, r }); void refresh(); }, onError: fail,
  });
  const act = useMutation({
    mutationFn: async ({ kind, p }: { kind: "delete" | "rotate"; p: Provider }) =>
      kind === "delete" ? api.delete(`/api/v1/integrations/telephony/${p.id}`) : api.post<{ secret: string; eventUrlPath: string }>(`/api/v1/integrations/telephony/${p.id}/rotate-secret`),
    onSuccess: (r, v) => { setConfirm(null); if (v.kind === "rotate") { const x = r as { secret: string; eventUrlPath: string }; setSecret({ value: x.secret, path: x.eventUrlPath }); } else push("Provider removed.", "success"); void refresh(); },
    onError: (e) => { setConfirm(null); fail(e); },
  });
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-ink">Telephony providers</h2>
            <p className="mt-1 text-sm text-muted">
              For complete call capture, connect a business phone system or PBX that can send a signed JSON webhook when a call starts, is answered, ends or is missed. Zulivio records each call on the
              matching lead's timeline, labelled “Imported from provider”. The provider's secret stays on your server.
            </p>
            <p className="mt-2 text-xs text-muted">
              Zulivio has no built-in connector for any specific vendor: a provider works if it can POST JSON and you can describe where each field lives below. Phones themselves can't supply every call —
              Android only lets the default phone app read the call log, so the Android app logs calls you start from it and ones you enter, and relies on a provider for everything else.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>Add provider</Button>
        </div>
      </Card>

      {isLoading ? <Skeleton className="h-24" /> : error ? (
        <ErrorState message={error instanceof ApiError && error.status === 403 ? "Only a Company Admin or Master Owner can manage telephony providers." : "Couldn't load providers."} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No provider connected" description="Add one to receive call events from your phone system. Until events arrive it's shown as “waiting”, never as connected." />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((p) => {
            const state = !p.enabled ? { tone: "warning" as const, text: "Disabled" } : p.delivery.lastEventAt ? { tone: "success" as const, text: "Receiving events" } : { tone: "info" as const, text: "Waiting for first event" };
            return (
              <li key={p.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{p.name} <span className="font-mono text-xs text-muted">{p.secretPreview}</span></p>
                    <p className="mt-1 break-all font-mono text-xs text-muted">POST {origin}{p.eventUrlPath}</p>
                    <p className="mt-2 text-xs text-muted">
                      {p.delivery.eventsReceived.toLocaleString()} received · {p.delivery.eventsRejected.toLocaleString()} rejected · Last event {when(p.delivery.lastEventAt)} · Last test {when(p.delivery.lastTestAt)}
                    </p>
                    {p.delivery.lastError && <p className="mt-1 text-xs text-coral">Last problem ({when(p.delivery.lastErrorAt)}): {p.delivery.lastError}</p>}
                  </div>
                  <Badge tone={state.tone}>{state.text}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={runTest.isPending} onClick={() => runTest.mutate(p)}>Test connection</Button>
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditing(p)}>Field &amp; event mapping</Button>
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => toggle.mutate(p)}>{p.enabled ? "Disable" : "Enable"}</Button>
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setConfirm({ kind: "rotate", p })}>Rotate secret</Button>
                  <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => setConfirm({ kind: "delete", p })}>Remove</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Add telephony provider">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Office PBX" /></Field>
          <Field label="How the provider proves it's genuine" hint="Signing is strongly preferred. Use a static header only if your provider can't compute an HMAC.">
            <Select value={auth} onChange={(e) => setAuth(e.target.value as "hmac" | "token")}>
              <option value="hmac">Signed requests (HMAC-SHA256)</option>
              <option value="token">Static secret header (X-Zulivio-Token)</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>{create.isPending ? "Adding…" : "Add provider"}</Button>
          </div>
        </form>
      </Dialog>

      <SecretOnceDialog
        secret={secret?.value ?? null}
        title="Provider secret"
        onClose={() => setSecret(null)}
        note={secret && <div className="flex flex-col gap-2 text-xs text-muted"><p>Configure your phone system to POST events to:</p><div className="flex items-center gap-2"><code className="break-all text-ink">{origin}{secret.path}</code><CopyButton value={`${origin}${secret.path}`} label="event URL" /></div></div>}
      />
      {editing && <MappingDialog provider={editing} catalog={catalog} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />}
      <TestDialog state={testing} onClose={() => setTesting(null)} />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "delete" ? `Remove “${confirm.p.name}”?` : `Rotate the secret for “${confirm?.p.name}”?`}
        confirmLabel={confirm?.kind === "delete" ? "Remove provider" : "Rotate now"}
        pending={act.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm)}
      >
        {confirm?.kind === "delete" ? "Its recorded call events are removed with it. Calls already shown on lead timelines stay." : "The old secret stops working immediately; update your phone system straight away."}
      </ConfirmDialog>
    </div>
  );
}

function MappingDialog({ provider, catalog, onClose, onSaved }: { provider: Provider; catalog: Catalog | undefined; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const defaults = catalog?.telephony.defaultFields ?? {};
  const [fields, setFields] = useState<Record<string, string>>(provider.fields);
  const [map, setMap] = useState(Object.entries(provider.statusMap).map(([k, v]) => `${k} = ${v}`).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const statusMap: Record<string, string> = {};
      for (const line of map.split("\n")) {
        const [k, v] = line.split("=").map((s) => s.trim());
        if (k && v) statusMap[k] = v;
      }
      return api.patch(`/api/v1/integrations/telephony/${provider.id}`, { fields, statusMap });
    },
    onSuccess: () => { push("Mapping saved.", "success"); onSaved(); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't save"),
  });
  return (
    <Dialog open onClose={onClose} title={`Mapping · ${provider.name}`} className="max-w-2xl">
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <p className="text-sm text-muted">Tell Zulivio where each fact is in your provider's JSON, as a dot path (for example <code className="text-xs">data.call.id</code>).</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.keys(defaults).map((key) => (
            <Field key={key} label={FIELD_HELP[key] ?? key} hint={key}>
              <Input value={fields[key] ?? defaults[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} className="font-mono text-xs" />
            </Field>
          ))}
        </div>
        <Field label="Event words" hint="One per line: the provider's word = started, answered, completed or missed.">
          <textarea value={map} onChange={(e) => setMap(e.target.value)} rows={6} className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-emerald" />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save mapping"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function TestDialog({ state, onClose }: { state: { p: Provider; r: TestResult } | null; onClose: () => void }) {
  const r = state?.r;
  return (
    <Dialog open={state !== null} onClose={onClose} title="Connection test" className="max-w-2xl">
      {r && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">This is a dry run of your mapping against a sample event. Nothing was stored and nothing was sent.</p>
          <p>{r.ok ? <Badge tone="success">Mapping works</Badge> : <Badge tone="danger">Mapping problem</Badge>}</p>
          {r.error && <ErrorState message={r.error} />}
          {r.normalized && <pre className="overflow-x-auto rounded-lg border border-border bg-canvas p-3 text-xs">{JSON.stringify(r.normalized, null, 2)}</pre>}
          <div className="rounded-lg border border-border p-3 text-xs text-muted">
            <p className="font-medium text-ink">How your provider should sign events</p>
            <p className="mt-1">Header <code>{r.signing.header}</code>: <code>{r.signing.format}</code> — rejected if older than {r.signing.toleranceSeconds / 60} minutes.</p>
            {r.signing.alternative && <p className="mt-1">{r.signing.alternative}</p>}
          </div>
          <p className="text-xs text-muted">To confirm real delivery, make a test call and watch “Last event” on the provider.</p>
        </div>
      )}
    </Dialog>
  );
}
