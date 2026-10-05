"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmployeeSummary } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorState, Input, Select, Spinner, useToast } from "@/components/ui";
import {
  IMPORT_BATCH_SIZE,
  MAX_IMPORT_FILE_BYTES,
  parseCallHistoryFile,
  type MobileDevice,
} from "@/lib/mobile-calls";

interface ImportResult {
  received: number;
  created: number;
  duplicates: number;
  rejected: number;
  failed: number;
}

const ENDPOINT_PATH = "/api/v1/mobile/calls";

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString() : "never";
}

/** Settings → Mobile Devices: register phones, show the one-time token + MacroDroid setup, verify, import old history. */
export function MobileDevicesPanel() {
  const queryClient = useQueryClient();
  const { push } = useToast();

  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get("/api/v1/employees"),
  });
  const { data: devices, isLoading, error } = useQuery<MobileDevice[]>({
    queryKey: ["mobile-devices"],
    queryFn: () => api.get("/api/v1/mobile/devices"),
    // While the setup wizard waits for the first test event.
    refetchInterval: (q) => (q.state.data?.some((d) => !d.lastSeenAt) ? 5000 : false),
  });
  const { data: settings } = useQuery<{ callRetentionDays: number | null }>({
    queryKey: ["mobile-settings"],
    queryFn: () => api.get("/api/v1/mobile/settings"),
  });

  const [employeeId, setEmployeeId] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // The raw token lives only in this component's memory, never in the cache or storage.
  const [revealed, setRevealed] = useState<MobileDevice | null>(null);
  const [retention, setRetention] = useState("");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mobile-devices"] });
  const onError = (err: unknown) => push(err instanceof ApiError ? err.message : "That didn't work.", "error");

  const create = useMutation({
    mutationFn: () =>
      api.post<MobileDevice>("/api/v1/mobile/devices", {
        deviceId: deviceId.trim(),
        name: name.trim(),
        employeeId,
        ...(phone.trim() ? { phoneNumber: phone.trim() } : {}),
      }),
    onSuccess: (device) => {
      setFormError(null);
      setRevealed(device);
      setDeviceId("");
      setName("");
      setPhone("");
      refresh();
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not add the device"),
  });
  const regenerate = useMutation({
    mutationFn: (id: string) => api.post<MobileDevice>(`/api/v1/mobile/devices/${id}/regenerate-token`),
    onSuccess: (d) => {
      setRevealed(d);
      refresh();
    },
    onError,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) =>
      api.post(`/api/v1/mobile/devices/${id}/status`, { status }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/mobile/devices/${id}`),
    onSuccess: () => {
      push("Device and its call history removed.", "success");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["mobile-calls"] });
    },
    onError,
  });
  const clearCalls = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/mobile/devices/${id}/calls`),
    onSuccess: () => {
      push("Call history deleted.", "success");
      refresh();
      queryClient.invalidateQueries({ queryKey: ["mobile-calls"] });
    },
    onError,
  });
  const saveRetention = useMutation({
    mutationFn: (days: number | null) => api.patch("/api/v1/mobile/settings", { callRetentionDays: days }),
    onSuccess: () => {
      push("Retention updated.", "success");
      queryClient.invalidateQueries({ queryKey: ["mobile-settings"] });
    },
    onError,
  });

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      push("Copied to clipboard.", "success");
    } catch {
      push("Could not copy — select the text and copy it manually.", "error");
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const active = (employees ?? []).filter((e) => e.employmentStatus === "ACTIVE");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <h2 className="mb-1 text-sm font-medium text-ink">Add a mobile device</h2>
        <p className="mb-4 text-sm text-muted">
          Each phone gets its own token and is tied to one employee. The phone only sends call metadata (number, type,
          time, duration) — never audio, messages or contacts.
        </p>
        {formError && <ErrorState message={formError} />}
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            create.mutate();
          }}
        >
          <Input aria-label="Device name" placeholder="Device name, e.g. Sales Phone 01" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input aria-label="Device ID" placeholder="Device ID, e.g. android-sales-01" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{1,63}" title="2-64 letters, digits, _ . -" required />
          <Select aria-label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
            <option value="" disabled>
              Assign to employee…
            </option>
            {active.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName} ({e.employeeNumber})
              </option>
            ))}
          </Select>
          <Input aria-label="SIM phone number (optional)" placeholder="SIM number (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div>
            <Button type="submit" disabled={create.isPending || !employeeId || !name.trim() || !deviceId.trim()}>
              {create.isPending ? "Creating…" : "Add device & generate token"}
            </Button>
          </div>
        </form>
      </Card>

      {revealed?.token && (
        <Card className="border-emerald/40 bg-emerald/5">
          <h2 className="mb-1 text-sm font-medium text-ink">Set up &quot;{revealed.name}&quot;</h2>
          <p className="mb-3 text-sm text-coral">
            Copy this token now and store it securely — it is shown only once. If it is lost, regenerate it (the old one
            stops working immediately).
          </p>
          <CopyRow label="Token" value={revealed.token} onCopy={copy} />
          <CopyRow label="URL" value={`${origin}${ENDPOINT_PATH}`} onCopy={copy} />
          <CopyRow label="Header" value={`Authorization: Bearer ${revealed.token}`} onCopy={copy} />
          <p className="mb-1 mt-3 text-xs font-medium text-muted">MacroDroid HTTP Request body (one macro per call type)</p>
          <pre className="overflow-x-auto rounded-md bg-surface p-2 text-xs">{macroBody(revealed.deviceId)}</pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => copy(macroBody(revealed.deviceId))}>
              Copy body
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => copy(testCurl(origin, revealed.token ?? "", revealed.deviceId))}>
              Copy test command (curl)
            </Button>
            <button type="button" className="text-xs text-muted underline" onClick={() => setRevealed(null)}>
              I&apos;ve saved it — hide
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            Full MacroDroid walkthrough: docs/integrations/macrodroid.md in the repository. Run the test command (or a
            MacroDroid test run) — the device row below turns to &quot;Connected&quot; once the server hears from it.
          </p>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-medium text-ink">Registered devices</h2>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ErrorState message="Could not load devices." />
        ) : !devices || devices.length === 0 ? (
          <p className="text-sm text-muted">No devices yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {devices.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                busy={regenerate.isPending || setStatus.isPending || remove.isPending || clearCalls.isPending}
                onRegenerate={() => {
                  if (window.confirm(`Regenerate the token for "${d.name}"? The phone stops syncing until it is updated.`)) regenerate.mutate(d.id);
                }}
                onToggle={() => setStatus.mutate({ id: d.id, status: d.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}
                onClear={() => {
                  if (window.confirm(`Delete ALL call history synced from "${d.name}"? This cannot be undone.`)) clearCalls.mutate(d.id);
                }}
                onRemove={() => {
                  if (window.confirm(`Remove "${d.name}" and delete its call history? This cannot be undone.`)) remove.mutate(d.id);
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-medium text-ink">Call history retention</h2>
        <p className="mb-3 text-sm text-muted">
          Automatically delete call records older than this many days (minimum 30). Leave empty to keep history
          indefinitely. {settings?.callRetentionDays ? `Currently ${settings.callRetentionDays} days.` : "Currently kept indefinitely."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Retention days" type="number" min={30} max={3650} placeholder="Days" value={retention} onChange={(e) => setRetention(e.target.value)} className="max-w-[8rem]" />
          <Button disabled={saveRetention.isPending || (retention !== "" && Number(retention) < 30)} onClick={() => saveRetention.mutate(retention === "" ? null : Number(retention))}>
            Save
          </Button>
        </div>
      </Card>
    </div>
  );
}

function macroBody(deviceId: string) {
  // Only magic text MacroDroid documents for call triggers: {call_number}, {call_name}.
  // call_type is fixed per macro (Incoming / Outgoing / Missed trigger); time is stamped by the server if omitted.
  return JSON.stringify(
    { device_id: deviceId, phone_number: "{call_number}", contact_name: "{call_name}", call_type: "incoming", metadata: { source: "macrodroid" } },
    null,
    2,
  );
}

function testCurl(origin: string, token: string, deviceId: string) {
  return `curl -X POST ${origin}/api/v1/mobile/devices/test -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"device_id":"${deviceId}"}'`;
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-muted">{label}</span>
      <code className="min-w-0 flex-1 break-all rounded-md bg-surface px-2 py-1.5 text-xs">{value}</code>
      <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onCopy(value)}>
        Copy
      </Button>
    </div>
  );
}

function DeviceRow({
  device: d,
  busy,
  onRegenerate,
  onToggle,
  onClear,
  onRemove,
}: {
  device: MobileDevice;
  busy: boolean;
  onRegenerate: () => void;
  onToggle: () => void;
  onClear: () => void;
  onRemove: () => void;
}) {
  const connected = !!d.lastSeenAt;
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink">
            {d.name} <span className="text-muted">({d.deviceId} · ····{d.tokenLastFour})</span>
          </p>
          <p className="text-xs text-muted">
            {d.employee.fullName} ({d.employee.employeeNumber}){d.phoneNumber && ` · ${d.phoneNumber}`} · {(d.callCount ?? 0).toLocaleString()} calls
          </p>
          <p className="text-xs text-muted">
            Created {new Date(d.createdAt).toLocaleDateString()} · Last seen {when(d.lastSeenAt)} · Last sync {when(d.lastSyncAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d.status === "DISABLED" ? <Badge tone="warning">Disabled</Badge> : connected ? <Badge tone="success">Connected</Badge> : <Badge tone="info">Waiting for first event</Badge>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ImportHistory device={d} />
        <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy} onClick={onRegenerate}>
          Regenerate token
        </Button>
        <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy} onClick={onToggle}>
          {d.status === "ACTIVE" ? "Revoke / disable" : "Enable"}
        </Button>
        <Button variant="danger" className="px-3 py-1.5 text-xs" disabled={busy} onClick={onClear}>
          Delete call data
        </Button>
        <Button variant="danger" className="px-3 py-1.5 text-xs" disabled={busy} onClick={onRemove}>
          Remove device
        </Button>
      </div>
    </li>
  );
}

/** Reads a call-history file in the browser and uploads it in 500-record batches (safe to re-run: duplicates are skipped). */
function ImportHistory({ device }: { device: MobileDevice }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(file: File) {
    setError(null);
    setResult(null);
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setError("File is larger than 25 MB.");
      return;
    }
    try {
      const records = parseCallHistoryFile(file.name, await file.text());
      if (records.length === 0) throw new Error("No call records found in that file.");
      const total: ImportResult = { received: 0, created: 0, duplicates: 0, rejected: 0, failed: 0 };
      for (let i = 0; i < records.length; i += IMPORT_BATCH_SIZE) {
        setProgress(`Uploading ${Math.min(i + IMPORT_BATCH_SIZE, records.length).toLocaleString()} / ${records.length.toLocaleString()}…`);
        const r = await api.post<ImportResult>(`/api/v1/mobile/devices/${device.id}/import`, { calls: records.slice(i, i + IMPORT_BATCH_SIZE) });
        for (const k of Object.keys(total) as (keyof ImportResult)[]) total[k] += r[k];
      }
      setResult(total);
      queryClient.invalidateQueries({ queryKey: ["mobile-devices"] });
      queryClient.invalidateQueries({ queryKey: ["mobile-calls"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input ref={input} type="file" accept=".xml,.csv,.json" hidden onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
      <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={progress !== null} onClick={() => input.current?.click()}>
        {progress ?? "Import old history…"}
      </Button>
      {result && (
        <span className="text-xs text-muted">
          {result.created.toLocaleString()} imported · {result.duplicates.toLocaleString()} already present · {result.rejected.toLocaleString()} skipped (invalid)
          {result.failed > 0 && ` · ${result.failed} failed — re-run the import`}
        </span>
      )}
      {error && <span className="text-xs text-coral">{error}</span>}
    </div>
  );
}
