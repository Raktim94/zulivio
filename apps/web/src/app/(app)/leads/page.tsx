"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { AssignmentRuleMode, AssignmentRuleSummary, EmployeeSummary, LeadStatus, LeadSummary } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorState, Input, Select, Spinner } from "@/components/ui";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";

const STATUS_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: ["CONTACTED", "DISQUALIFIED"],
  CONTACTED: ["QUALIFIED", "DISQUALIFIED"],
  QUALIFIED: ["DISQUALIFIED"],
  DISQUALIFIED: [],
  CONVERTED: [],
};

const STATUS_TONE: Record<LeadStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  NEW: "info",
  CONTACTED: "warning",
  QUALIFIED: "success",
  DISQUALIFIED: "neutral",
  CONVERTED: "success",
};

export default function LeadsPage() {
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const managerView = isManagerOrAbove(employee?.role);

  const { data: leads, isLoading, error } = useQuery<LeadSummary[]>({
    queryKey: ["leads"],
    queryFn: () => api.get<LeadSummary[]>("/api/v1/leads"),
  });

  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
    enabled: managerView,
  });

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    source: "",
    territory: "",
    autoAssign: true,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertTitle, setConvertTitle] = useState("");
  const [convertAmount, setConvertAmount] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ createdCount: number; errorCount: number } | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  const createLead = useMutation({
    mutationFn: () =>
      api.post("/api/v1/leads", {
        ...form,
        email: form.email || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        source: form.source || undefined,
        territory: form.territory || undefined,
      }),
    onSuccess: () => {
      setForm({ fullName: "", email: "", phone: "", company: "", source: "", territory: "", autoAssign: true });
      invalidate();
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not create lead"),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      api.patch(`/api/v1/leads/${id}`, { status }),
    onSuccess: invalidate,
  });

  const convertLead = useMutation({
    mutationFn: (id: string) =>
      api.post(`/api/v1/leads/${id}/convert`, {
        title: convertTitle,
        amountMinor: convertAmount ? Math.round(parseFloat(convertAmount) * 100) : undefined,
      }),
    onSuccess: () => {
      setConvertingId(null);
      setConvertTitle("");
      setConvertAmount("");
      invalidate();
    },
  });

  const importCsv = useMutation({
    mutationFn: () => {
      if (!importFile) throw new Error("Choose a CSV file first");
      return api.upload<{ createdCount: number; errorCount: number }>("/api/v1/imports/leads/csv", importFile);
    },
    onSuccess: (result) => {
      setImportResult(result);
      setImportFile(null);
      invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Leads</h1>
          <p className="text-sm text-muted">Capture, qualify, and convert leads into opportunities.</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/v1/exports/leads.csv">
            <Button variant="secondary">Export CSV</Button>
          </a>
        </div>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">New lead</h2>
        {formError && <div className="mb-3"><ErrorState message={formError} /></div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            createLead.mutate();
          }}
          className="grid grid-cols-1 gap-3 md:grid-cols-3"
        >
          <Input
            placeholder="Full name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            required
          />
          <Input
            type="email"
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Input
            placeholder="Company (optional)"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
          <Input
            placeholder="Source (optional)"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          />
          <Input
            placeholder="Territory (optional)"
            value={form.territory}
            onChange={(e) => setForm({ ...form, territory: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.autoAssign}
              onChange={(e) => setForm({ ...form, autoAssign: e.target.checked })}
            />
            Auto-assign via active rotation rule
          </label>
          <div className="md:col-span-3">
            <Button type="submit" disabled={createLead.isPending}>
              {createLead.isPending ? "Creating..." : "Create lead"}
            </Button>
          </div>
        </form>
      </Card>

      {managerView && (
        <Card>
          <h2 className="mb-3 text-sm font-medium text-ink">Import from CSV</h2>
          <p className="mb-3 text-xs text-muted">
            Header row must include <code className="rounded bg-canvas px-1">full_name</code>, and optionally{" "}
            <code className="rounded bg-canvas px-1">email</code>, <code className="rounded bg-canvas px-1">phone</code>,{" "}
            <code className="rounded bg-canvas px-1">company</code>, <code className="rounded bg-canvas px-1">source</code>.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" accept=".csv,text/csv" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
            <Button
              variant="secondary"
              disabled={!importFile || importCsv.isPending}
              onClick={() => importCsv.mutate()}
            >
              {importCsv.isPending ? "Importing..." : "Import"}
            </Button>
          </div>
          {importResult && (
            <p className="mt-3 text-sm text-ink">
              {importResult.createdCount} created, {importResult.errorCount} errors
            </p>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Directory</h2>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ErrorState message="Could not load leads." />
        ) : !leads || leads.length === 0 ? (
          <p className="text-sm text-muted">No leads yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {leads.map((lead) => {
              const options = STATUS_TRANSITIONS[lead.status];
              const overdue =
                lead.respondBySlaAt &&
                !lead.firstRespondedAt &&
                new Date(lead.respondBySlaAt) < new Date() &&
                (lead.status === "NEW" || lead.status === "CONTACTED");

              return (
                <div key={lead.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {lead.fullName} {lead.company && <span className="text-muted">· {lead.company}</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {lead.owner ? `${lead.owner.fullName} (${lead.owner.employeeNumber})` : "Unassigned"}
                        {lead.email && ` · ${lead.email}`}
                        {lead.phone && ` · ${lead.phone}`}
                        {lead.territory && ` · ${lead.territory}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {overdue && <Badge tone="danger">SLA overdue</Badge>}
                      <Badge tone={STATUS_TONE[lead.status]}>{lead.status}</Badge>
                      {options.length > 0 && (
                        <Select
                          className="w-40"
                          defaultValue=""
                          onChange={(e) => {
                            const status = e.target.value as LeadStatus;
                            if (status) updateStatus.mutate({ id: lead.id, status });
                          }}
                        >
                          <option value="" disabled>
                            Move to...
                          </option>
                          {options.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </Select>
                      )}
                      {lead.status === "QUALIFIED" && (
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => {
                            setConvertingId(lead.id);
                            setConvertTitle(`${lead.fullName} — deal`);
                          }}
                        >
                          Convert
                        </Button>
                      )}
                      {lead.convertedOpportunityId && (
                        <Link href="/pipeline" className="text-xs text-emerald underline">
                          View opportunity
                        </Link>
                      )}
                    </div>
                  </div>

                  {convertingId === lead.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        convertLead.mutate(lead.id);
                      }}
                      className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3"
                    >
                      <Input
                        className="w-56"
                        placeholder="Opportunity title"
                        value={convertTitle}
                        onChange={(e) => setConvertTitle(e.target.value)}
                        required
                      />
                      <Input
                        className="w-32"
                        placeholder="Amount (₹)"
                        type="number"
                        min="0"
                        step="0.01"
                        value={convertAmount}
                        onChange={(e) => setConvertAmount(e.target.value)}
                      />
                      <Button type="submit" className="px-3 py-1.5 text-xs" disabled={convertLead.isPending}>
                        {convertLead.isPending ? "Converting..." : "Confirm conversion"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setConvertingId(null)}
                        className="text-xs text-muted underline"
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {managerView && employees && <AssignmentRules employees={employees} />}
    </div>
  );
}

const MODE_LABEL: Record<AssignmentRuleMode, string> = {
  ROUND_ROBIN: "Round robin",
  TERRITORY: "Territory",
  CAPACITY: "Capacity",
};

function AssignmentRules({ employees }: { employees: EmployeeSummary[] }) {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery<AssignmentRuleSummary[]>({
    queryKey: ["assignment-rules"],
    queryFn: () => api.get("/api/v1/assignment-rules"),
  });

  const [name, setName] = useState("");
  const [slaMinutes, setSlaMinutes] = useState("60");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [mode, setMode] = useState<AssignmentRuleMode>("ROUND_ROBIN");
  const [territoryRows, setTerritoryRows] = useState<{ territory: string; employeeId: string }[]>([
    { territory: "", employeeId: "" },
  ]);
  const [maxOpenLeads, setMaxOpenLeads] = useState("");

  const employeeName = (id: string) => employees.find((e) => e.id === id)?.fullName ?? id;

  const createRule = useMutation({
    mutationFn: () => {
      const territoryMap =
        mode === "TERRITORY"
          ? Object.fromEntries(
              territoryRows
                .filter((row) => row.territory.trim() && row.employeeId)
                .map((row) => [row.territory.trim(), row.employeeId]),
            )
          : undefined;

      return api.post("/api/v1/assignment-rules", {
        name,
        slaMinutes: Number(slaMinutes),
        memberIds,
        mode,
        territoryMap: territoryMap && Object.keys(territoryMap).length > 0 ? territoryMap : undefined,
        maxOpenLeads: mode === "CAPACITY" && maxOpenLeads ? Number(maxOpenLeads) : undefined,
      });
    },
    onSuccess: () => {
      setName("");
      setMemberIds([]);
      setMode("ROUND_ROBIN");
      setTerritoryRows([{ territory: "", employeeId: "" }]);
      setMaxOpenLeads("");
      queryClient.invalidateQueries({ queryKey: ["assignment-rules"] });
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/api/v1/assignment-rules/${id}/active`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assignment-rules"] }),
  });

  return (
    <Card>
      <h2 className="mb-4 text-sm font-medium text-ink">Assignment rules</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createRule.mutate();
        }}
        className="grid grid-cols-1 gap-3 md:grid-cols-4"
      >
        <Input placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          type="number"
          min="1"
          placeholder="SLA minutes"
          value={slaMinutes}
          onChange={(e) => setSlaMinutes(e.target.value)}
        />
        <Select value={mode} onChange={(e) => setMode(e.target.value as AssignmentRuleMode)}>
          <option value="ROUND_ROBIN">Round robin</option>
          <option value="TERRITORY">Territory</option>
          <option value="CAPACITY">Capacity</option>
        </Select>
        {mode === "CAPACITY" ? (
          <Input
            type="number"
            min="0"
            placeholder="Max open leads/member (blank = unlimited)"
            value={maxOpenLeads}
            onChange={(e) => setMaxOpenLeads(e.target.value)}
          />
        ) : (
          <div />
        )}

        <select
          multiple
          value={memberIds}
          onChange={(e) => setMemberIds(Array.from(e.target.selectedOptions, (o) => o.value))}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm md:col-span-4"
        >
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.employeeNumber} — {emp.fullName}
            </option>
          ))}
        </select>

        {mode === "TERRITORY" && (
          <div className="flex flex-col gap-2 md:col-span-4">
            <p className="text-xs text-muted">
              Map a lead&apos;s territory (matched case-insensitively) to the member who should own it. Leads
              with no match fall back to round robin across the members selected above.
            </p>
            {territoryRows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="Territory, e.g. north"
                  value={row.territory}
                  onChange={(e) => {
                    const next = [...territoryRows];
                    next[i] = { ...next[i], territory: e.target.value };
                    setTerritoryRows(next);
                  }}
                />
                <Select
                  className="flex-1"
                  value={row.employeeId}
                  onChange={(e) => {
                    const next = [...territoryRows];
                    next[i] = { ...next[i], employeeId: e.target.value };
                    setTerritoryRows(next);
                  }}
                >
                  <option value="">Owner...</option>
                  {employees
                    .filter((emp) => memberIds.includes(emp.id))
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </option>
                    ))}
                </Select>
                <button
                  type="button"
                  className="text-xs text-muted underline"
                  onClick={() => setTerritoryRows(territoryRows.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="self-start text-xs text-emerald underline"
              onClick={() => setTerritoryRows([...territoryRows, { territory: "", employeeId: "" }])}
            >
              + Add territory
            </button>
          </div>
        )}

        <div className="md:col-span-4">
          <Button type="submit" disabled={createRule.isPending || memberIds.length === 0}>
            {createRule.isPending ? "Creating..." : "Create rule"}
          </Button>
        </div>
      </form>

      {rules && rules.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {rule.name}{" "}
                <span className="text-muted">
                  · {MODE_LABEL[rule.mode]} · {rule.memberIds.length} members · SLA {rule.slaMinutes}m
                  {rule.mode === "CAPACITY" &&
                    ` · cap ${rule.maxOpenLeads ?? "unlimited"}/member`}
                  {rule.mode === "TERRITORY" &&
                    rule.territoryMap &&
                    Object.keys(rule.territoryMap).length > 0 &&
                    ` · ${Object.entries(rule.territoryMap)
                      .map(([territory, employeeId]) => `${territory}→${employeeName(employeeId)}`)
                      .join(", ")}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => toggleActive.mutate({ id: rule.id, isActive: !rule.isActive })}
                className="shrink-0 cursor-pointer"
              >
                <Badge tone={rule.isActive ? "success" : "neutral"}>{rule.isActive ? "Active" : "Paused"}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
