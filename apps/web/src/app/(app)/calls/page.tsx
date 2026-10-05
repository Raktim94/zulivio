"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Select, Spinner, useToast } from "@/components/ui";
import { isManagerOrAbove, useCurrentEmployee } from "@/lib/use-current-employee";
import {
  CALL_TYPE_TONE,
  formatDuration,
  type CallSummaryRow,
  type MobileCallDetail,
  type MobileCallList,
  type MobileCallRow,
  type MobileDevice,
} from "@/lib/mobile-calls";

interface Filters {
  q: string;
  phone: string;
  callType: string;
  employeeId: string;
  deviceId: string;
  from: string;
  to: string;
  minDuration: string;
  source: string;
  assoc: "" | "linked" | "unassigned";
}

const EMPTY: Filters = { q: "", phone: "", callType: "", employeeId: "", deviceId: "", from: "", to: "", minDuration: "", source: "", assoc: "" };
const PAGE_SIZE = 25;

function dayStart(d: string) {
  return new Date(`${d}T00:00:00`).toISOString();
}
function dayEnd(d: string) {
  return new Date(`${d}T23:59:59.999`).toISOString();
}

function toQuery(f: Filters, page: number) {
  const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.phone.trim()) p.set("phone_number", f.phone.trim());
  if (f.callType) p.set("call_type", f.callType);
  if (f.employeeId) p.set("employee_id", f.employeeId);
  if (f.deviceId) p.set("device_id", f.deviceId);
  if (f.from) p.set("from", dayStart(f.from));
  if (f.to) p.set("to", dayEnd(f.to));
  if (f.minDuration) p.set("min_duration", f.minDuration);
  if (f.source) p.set("source", f.source);
  if (f.assoc === "unassigned") p.set("unassigned", "true");
  return p;
}

export default function CallsPage() {
  const { data: me } = useCurrentEmployee();
  const manager = isManagerOrAbove(me?.role);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<MobileCallList>({
    queryKey: ["mobile-calls", filters, page],
    queryFn: () => api.get<MobileCallList>(`/api/v1/mobile/calls?${toQuery(filters, page)}`),
    placeholderData: (prev) => prev,
  });

  // Today's per-employee activity (scoped server-side to what this user may see).
  const todayFrom = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const { data: summary } = useQuery<{ employees: CallSummaryRow[] }>({
    queryKey: ["mobile-calls", "summary", todayFrom],
    queryFn: () => api.get(`/api/v1/mobile/calls/summary?from=${encodeURIComponent(todayFrom)}`),
  });

  // Filter pickers: team members and devices come from endpoints the role may call.
  const { data: team } = useQuery<{ id: string; fullName: string }[]>({
    queryKey: ["employees"],
    queryFn: () => api.get("/api/v1/employees"),
    enabled: manager,
  });
  const { data: devices } = useQuery<MobileDevice[]>({
    queryKey: ["mobile-devices"],
    queryFn: () => api.get("/api/v1/mobile/devices"),
    enabled: me?.role === "COMPANY_ADMIN" || me?.role === "MASTER_OWNER",
  });

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const apply = () => {
    setFilters(draft);
    setPage(1);
  };
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Calls</h1>
        <p className="text-sm text-muted">
          Call history (metadata only — no audio) synced from registered company phones.
        </p>
      </div>

      {summary && summary.employees.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-medium text-ink">Today</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summary.employees.map((e) => (
              <li key={e.employeeId} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-ink">{e.employeeName}</p>
                <p className="text-xs text-muted">
                  {e.outgoing} outgoing · {e.incoming} incoming · {e.missed} missed ·{" "}
                  {formatDuration(e.totalDurationSeconds)} total
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Input aria-label="Search name or number" placeholder="Search name or number" value={draft.q} onChange={(e) => set("q", e.target.value)} />
          <Input aria-label="Phone number" placeholder="Exact phone number" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
          <Select aria-label="Call type" value={draft.callType} onChange={(e) => set("callType", e.target.value)}>
            <option value="">All types</option>
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
            <option value="missed">Missed</option>
            <option value="rejected">Rejected</option>
            <option value="blocked">Blocked</option>
            <option value="unknown">Unknown</option>
          </Select>
          <Select aria-label="CRM association" value={draft.assoc} onChange={(e) => set("assoc", e.target.value as Filters["assoc"])}>
            <option value="">Linked and unassigned</option>
            <option value="unassigned">Unknown / unassigned only</option>
          </Select>
          {manager && (
            <Select aria-label="Employee" value={draft.employeeId} onChange={(e) => set("employeeId", e.target.value)}>
              <option value="">All employees</option>
              {(team ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </Select>
          )}
          {devices && (
            <Select aria-label="Device" value={draft.deviceId} onChange={(e) => set("deviceId", e.target.value)}>
              <option value="">All devices</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
          <Input aria-label="From date" type="date" value={draft.from} onChange={(e) => set("from", e.target.value)} />
          <Input aria-label="To date" type="date" value={draft.to} onChange={(e) => set("to", e.target.value)} />
          <Input aria-label="Minimum duration in seconds" type="number" min={0} placeholder="Min duration (s)" value={draft.minDuration} onChange={(e) => set("minDuration", e.target.value)} />
          <Input aria-label="Source" placeholder="Source (macrodroid, android…)" value={draft.source} onChange={(e) => set("source", e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDraft(EMPTY);
                setFilters(EMPTY);
                setPage(1);
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </Card>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error instanceof ApiError ? error.message : "Could not load calls."} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="No calls" description="No calls match these filters. Register a device under Settings → Mobile Devices to start syncing." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-canvas/60 text-left text-xs font-medium uppercase tracking-wide text-muted">
                  {["Date / time", "Contact", "Phone", "Type", "Employee", "Device", "Duration", "SIM", "CRM", "Source"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => setOpenId(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenId(c.id);
                      }
                    }}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-canvas/40 focus:bg-canvas/60 focus:outline-none"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5">{new Date(c.startedAt).toLocaleString()}</td>
                    <td className="px-3 py-2.5">{c.lead?.fullName ?? c.contactName ?? <span className="text-muted">Unknown</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{c.phoneNumber}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={CALL_TYPE_TONE[c.callType]}>{c.callType}</Badge>
                    </td>
                    <td className="px-3 py-2.5">{c.employee.fullName}</td>
                    <td className="px-3 py-2.5">{c.device.name}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{formatDuration(c.durationSeconds)}</td>
                    <td className="px-3 py-2.5">{[c.simSlot && `SIM ${c.simSlot}`, c.simName].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2.5">{c.lead ? <Badge tone="success">Lead</Badge> : <Badge tone="neutral">Unassigned</Badge>}</td>
                    <td className="px-3 py-2.5">{c.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Pagination" className="flex items-center justify-between text-sm text-muted">
            <span>
              Page {page} of {totalPages} · {data.total.toLocaleString()} calls
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </nav>
        </>
      )}

      <CallDetailDialog id={openId} onClose={() => setOpenId(null)} canDelete={me?.role === "COMPANY_ADMIN" || me?.role === "MASTER_OWNER"} />
    </div>
  );
}

function CallDetailDialog({ id, onClose, canDelete }: { id: string | null; onClose: () => void; canDelete: boolean }) {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [leadId, setLeadId] = useState("");
  const [name, setName] = useState("");

  const { data, isLoading } = useQuery<MobileCallDetail>({
    queryKey: ["mobile-calls", "detail", id],
    queryFn: () => api.get<MobileCallDetail>(`/api/v1/mobile/calls/${id}`),
    enabled: !!id,
  });
  const [leadQ, setLeadQ] = useState("");
  const { data: leadSearch } = useQuery<{ items: { id: string; fullName: string; phone: string | null }[] }>({
    queryKey: ["leads", "picker", leadQ],
    queryFn: () => api.get(`/api/v1/leads/search?pageSize=20${leadQ.trim() ? `&q=${encodeURIComponent(leadQ.trim())}` : ""}`),
    enabled: !!id && !!data && !data.lead,
  });
  const leads = leadSearch?.items ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["mobile-calls"] });
  const onError = (err: unknown) => push(err instanceof ApiError ? err.message : "That didn't work.", "error");

  const attach = useMutation({
    mutationFn: () => api.post(`/api/v1/mobile/calls/${id}/attach`, { leadId }),
    onSuccess: () => {
      push("Attached to lead.", "success");
      refresh();
    },
    onError,
  });
  const createLead = useMutation({
    mutationFn: () => api.post(`/api/v1/mobile/calls/${id}/create-lead`, name.trim() ? { fullName: name.trim() } : {}),
    onSuccess: () => {
      push("Lead created.", "success");
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/v1/mobile/calls/${id}`),
    onSuccess: () => {
      push("Call record deleted.", "success");
      refresh();
      onClose();
    },
    onError,
  });

  const row: MobileCallRow | undefined = data;
  return (
    <Dialog open={!!id} onClose={onClose} title="Call details">
      {isLoading || !row || !data ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            {(
              [
                ["Type", row.callType],
                ["Phone", row.phoneNumber],
                ["Normalized", row.phoneNumberNormalized],
                ["Name on phone", row.contactName ?? "—"],
                ["Started", new Date(row.startedAt).toLocaleString()],
                ["Ended", row.endedAt ? new Date(row.endedAt).toLocaleString() : "—"],
                ["Duration", formatDuration(row.durationSeconds)],
                ["Employee", row.employee.fullName],
                ["Device", `${row.device.name} (${row.device.deviceId})`],
                ["SIM", [row.simSlot && `slot ${row.simSlot}`, row.simName].filter(Boolean).join(" · ") || "—"],
                ["Source", row.source],
                ["Synced", new Date(data.syncedAt).toLocaleString()],
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="break-words text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          {data.metadata && (
            <div>
              <p className="mb-1 text-xs text-muted">Metadata</p>
              {/* Rendered as text by React — never as HTML. */}
              <pre className="overflow-x-auto rounded-md bg-surface p-2 text-xs">{JSON.stringify(data.metadata, null, 2)}</pre>
            </div>
          )}

          {row.lead ? (
            <p>
              CRM: <Link className="text-indigo underline" href={`/leads/${row.lead.id}`}>{row.lead.fullName}</Link>
            </p>
          ) : (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 font-medium text-ink">Unknown / unassigned number</p>
              <div className="mb-3 flex flex-wrap gap-2">
                <Input aria-label="Search leads" placeholder="Search leads…" value={leadQ} onChange={(e) => setLeadQ(e.target.value)} className="max-w-[10rem]" />
                <Select aria-label="Existing lead" value={leadId} onChange={(e) => setLeadId(e.target.value)} className="max-w-xs">
                  <option value="">Attach to existing lead…</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.fullName} {l.phone ? `(${l.phone})` : ""}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" disabled={!leadId || attach.isPending} onClick={() => attach.mutate()}>
                  Attach
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Input aria-label="New lead name" placeholder={row.contactName ?? row.phoneNumberNormalized} value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
                <Button disabled={createLead.isPending} onClick={() => createLead.mutate()}>
                  Create contact
                </Button>
              </div>
            </div>
          )}

          {canDelete && (
            <div>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Delete this record
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
