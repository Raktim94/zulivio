"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Select, Skeleton, useToast } from "@/components/ui";
import { ConfirmDialog, Field, SecretOnceDialog, STATUS_LABEL, statusTone, when, type Catalog } from "./shared";

interface Credential {
  id: string;
  name: string;
  preview: string;
  scopes: string[];
  owner: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "revoked" | "expired";
}

const EXPIRY = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days (recommended)" },
  { days: 180, label: "180 days" },
  { days: 365, label: "1 year" },
  { days: 730, label: "2 years (maximum)" },
];

/** Organization-level credentials for the /api/v1/ext API. Not the personal MCP keys in Settings, and not employee sessions. */
export function ApiClientsPanel({ catalog }: { catalog: Catalog | undefined }) {
  const qc = useQueryClient();
  const { push } = useToast();
  const { data, isLoading, error, refetch } = useQuery<Credential[]>({ queryKey: ["integrations", "credentials"], queryFn: () => api.get("/api/v1/integrations/credentials") });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "revoke" | "rotate"; c: Credential } | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ secret: string }>("/api/v1/integrations/credentials", { name, scopes, expiresInDays: days }),
    onSuccess: (r) => {
      setSecret(r.secret);
      setCreating(false);
      setName("");
      setScopes([]);
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e) => push(e instanceof ApiError ? e.message : "Could not create the credential", "error"),
  });
  const act = useMutation({
    mutationFn: async ({ kind, c }: { kind: "revoke" | "rotate"; c: Credential }) =>
      kind === "revoke" ? api.delete(`/api/v1/integrations/credentials/${c.id}`) : api.post<{ secret: string }>(`/api/v1/integrations/credentials/${c.id}/rotate`),
    onSuccess: (r, v) => {
      setConfirm(null);
      if (v.kind === "rotate") setSecret((r as { secret: string }).secret);
      else push("Credential revoked. It stopped working immediately.", "success");
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: (e) => { setConfirm(null); push(e instanceof ApiError ? e.message : "That didn't work", "error"); },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm font-semibold text-ink">API clients</h2>
            <p className="mt-1 text-sm text-muted">
              Credentials for other software (a website form, Zapier, your own scripts) to use the versioned <code className="text-xs">/api/v1/ext</code> API. Each one has
              only the scopes you tick, expires, and can be revoked instantly. They are separate from personal API keys (Settings → API Keys, used by MCP) and from employee logins.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>New API client</Button>
        </div>
      </Card>

      {isLoading ? <Skeleton className="h-24" /> : error ? (
        <ErrorState message={error instanceof ApiError && error.status === 403 ? "Only a Company Admin or Master Owner can manage API clients." : "Couldn't load API clients."} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No API clients yet" description="Create one when another system needs to read leads or send call events to Zulivio." />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((c) => (
            <li key={c.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {c.name} <span className="font-mono text-xs text-muted">{c.preview}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {c.scopes.map((s) => (
                      <Badge key={s} tone="info">{s}</Badge>
                    ))}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    Owner {c.owner ?? "—"} · Created {when(c.createdAt)} · Expires {when(c.expiresAt, "never")} · Last used {when(c.lastUsedAt)}
                  </p>
                </div>
                <Badge tone={statusTone(c.status)}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
              </div>
              {c.status !== "revoked" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setConfirm({ kind: "rotate", c })}>Rotate secret</Button>
                  <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => setConfirm({ kind: "revoke", c })}>Revoke</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <Button variant="secondary" onClick={() => void refetch()}>Try again</Button>}

      <Dialog open={creating} onClose={() => setCreating(false)} title="New API client">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Name" hint="Where it will be used, e.g. “Website contact form”.">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink">Scopes</legend>
            <p className="text-xs text-muted">A client can do only what you tick here. Start with the least you need.</p>
            {(catalog?.scopes ?? []).map((s) => (
              <label key={s.scope} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4" checked={scopes.includes(s.scope)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s.scope] : scopes.filter((x) => x !== s.scope))} />
                <span><span className="font-mono text-xs">{s.scope}</span> — {s.description}</span>
              </label>
            ))}
          </fieldset>
          <Field label="Expires after">
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {EXPIRY.map((x) => <option key={x.days} value={x.days}>{x.label}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || scopes.length === 0 || !name.trim()}>{create.isPending ? "Creating…" : "Create"}</Button>
          </div>
        </form>
      </Dialog>

      <SecretOnceDialog
        secret={secret}
        title="Your new API secret"
        onClose={() => setSecret(null)}
        note={<p className="text-xs text-muted">Send it as <code>Authorization: Bearer &lt;secret&gt;</code> to <code>/api/v1/ext/…</code>.</p>}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === "revoke" ? `Revoke “${confirm.c.name}”?` : `Rotate “${confirm?.c.name}”?`}
        confirmLabel={confirm?.kind === "revoke" ? "Revoke now" : "Rotate now"}
        pending={act.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm)}
      >
        {confirm?.kind === "revoke"
          ? "Anything using this credential will stop working immediately. This cannot be undone."
          : "A new secret is generated and the current one stops working immediately. Update whatever uses it right away."}
      </ConfirmDialog>
    </div>
  );
}
