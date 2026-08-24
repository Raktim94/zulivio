"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type {
  AssignmentRuleMode,
  AssignmentRuleSummary,
  EmployeeSummary,
  LeadPriority,
  LeadScoreConfigSummary,
  PipelineSummary,
} from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FileInput,
  Input,
  Select,
  Spinner,
  TabPanel,
  Tabs,
  useToast,
} from "@/components/ui";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";
import { LeadBoard } from "./lead-board";
import { LeadList } from "./lead-list";

const PRIORITIES: LeadPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];

/**
 * One route, three views. The board and the list are two ways to look at
 * the same lead set, and capture/configuration is where a lead enters —
 * separate pages for these would mean the same header, the same filters and
 * three navigation hops for one job.
 */
export default function LeadsPage() {
  const { data: employee } = useCurrentEmployee();
  const managerView = isManagerOrAbove(employee?.role);
  const [tab, setTab] = useState("board");

  const { data: pipelines, isLoading: pipelinesLoading } = useQuery<PipelineSummary[]>({
    queryKey: ["pipelines", "lead"],
    queryFn: () => api.get<PipelineSummary[]>("/api/v1/pipelines?kind=LEAD"),
  });

  const { data: scoreConfig } = useQuery<LeadScoreConfigSummary>({
    queryKey: ["leads", "score-config"],
    queryFn: () => api.get<LeadScoreConfigSummary>("/api/v1/leads/score-config"),
  });

  const stages = pipelines?.[0]?.stages ?? [];

  const tabs = [
    { id: "board", label: "Board" },
    { id: "list", label: "List" },
    { id: "capture", label: managerView ? "Capture & rules" : "Add a lead" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Leads</h1>
          <p className="text-sm text-muted">Call, qualify and move leads through the telecalling pipeline.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/my-day">
            <Button variant="secondary">My day</Button>
          </Link>
          <Link href="/follow-ups">
            <Button variant="secondary">Follow-ups</Button>
          </Link>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <TabPanel id="board" active={tab}>
        {pipelinesLoading ? (
          <Spinner />
        ) : stages.length === 0 ? (
          <ErrorState message="The telecalling pipeline has no stages configured." />
        ) : (
          <LeadBoard stages={stages} scoreConfig={scoreConfig} canBulkAct={managerView} />
        )}
      </TabPanel>

      <TabPanel id="list" active={tab}>
        <LeadList stages={stages} scoreConfig={scoreConfig} canBulkAct={managerView} />
      </TabPanel>

      <TabPanel id="capture" active={tab}>
        <div className="flex flex-col gap-6">
          <NewLeadForm />
          {managerView && <ImportLeads />}
          {managerView && <ScoringWeights config={scoreConfig} />}
          {managerView && <AssignmentRules />}
        </div>
      </TabPanel>
    </div>
  );
}

function NewLeadForm() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    jobTitle: "",
    website: "",
    source: "",
    campaign: "",
    territory: "",
    tags: "",
    priority: "NORMAL" as LeadPriority,
    autoAssign: true,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const createLead = useMutation({
    mutationFn: () =>
      api.post("/api/v1/leads", {
        fullName: form.fullName,
        email: form.email || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        jobTitle: form.jobTitle || undefined,
        website: form.website || undefined,
        source: form.source || undefined,
        campaign: form.campaign || undefined,
        territory: form.territory || undefined,
        tags: form.tags
          ? form.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        priority: form.priority,
        autoAssign: form.autoAssign,
      }),
    onSuccess: () => {
      setForm({
        fullName: "",
        email: "",
        phone: "",
        company: "",
        jobTitle: "",
        website: "",
        source: "",
        campaign: "",
        territory: "",
        tags: "",
        priority: "NORMAL",
        autoAssign: true,
      });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.push("Lead created", "success");
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not create lead"),
  });

  return (
    <Card>
      <h2 className="mb-4 text-sm font-medium text-ink">New lead</h2>
      {formError && (
        <div className="mb-3">
          <ErrorState message={formError} />
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFormError(null);
          createLead.mutate();
        }}
        className="grid grid-cols-1 gap-3 md:grid-cols-3"
      >
        <Input placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
        <Input type="email" placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Input placeholder="Company (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        <Input placeholder="Job title (optional)" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} />
        <Input placeholder="Website (optional)" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
        <Input placeholder="Source (optional)" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        <Input placeholder="Campaign (optional)" value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} />
        <Input placeholder="Territory (optional)" value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} />
        <Input placeholder="Tags, comma separated" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as LeadPriority })} aria-label="Priority">
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.autoAssign} onChange={(e) => setForm({ ...form, autoAssign: e.target.checked })} />
          Auto-assign via active rule
        </label>
        <div className="md:col-span-3">
          <Button type="submit" disabled={createLead.isPending}>
            {createLead.isPending ? "Creating…" : "Create lead"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ImportLeads() {
  const queryClient = useQueryClient();
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{
    createdCount: number;
    errorCount: number;
    errors: { row: number; message: string }[];
    detectedHeaders?: string[];
  } | null>(null);

  const importCsv = useMutation({
    mutationFn: () => {
      if (!importFile) throw new Error("Choose a CSV file first");
      return api.upload<{
        createdCount: number;
        errorCount: number;
        errors: { row: number; message: string }[];
        detectedHeaders?: string[];
      }>("/api/v1/imports/leads/csv", importFile);
    },
    onSuccess: (result) => {
      setImportResult(result);
      setImportFile(null);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    },
  });

  return (
    <Card>
      <h2 className="mb-3 text-sm font-medium text-ink">Import from CSV</h2>
      <p className="mb-3 text-xs text-muted">
        Header row must include <code className="rounded bg-canvas px-1">full_name</code>, and optionally{" "}
        <code className="rounded bg-canvas px-1">email</code>, <code className="rounded bg-canvas px-1">phone</code>,{" "}
        <code className="rounded bg-canvas px-1">company</code>, <code className="rounded bg-canvas px-1">source</code>.
      </p>
      <div className="flex flex-col items-start gap-3">
        <FileInput value={importFile} onChange={setImportFile} accept=".csv,text/csv" label="Choose CSV file" />
        <Button variant="secondary" disabled={!importFile || importCsv.isPending} onClick={() => importCsv.mutate()}>
          {importCsv.isPending ? "Importing…" : "Import"}
        </Button>
      </div>
      {importResult && (
        <div className="mt-3 text-sm">
          <p className="text-ink">
            {importResult.createdCount} created, {importResult.errorCount} errors
          </p>
          {importResult.errors.length > 0 && (
            <>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-coral">
                {importResult.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
              {importResult.detectedHeaders && (
                <p className="mt-2 text-xs text-muted">
                  Columns detected in your file: {importResult.detectedHeaders.join(", ") || "none"}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Lead scoring weights live in the database, so this is a real settings
 * form rather than documentation of constants baked into the build.
 */
function ScoringWeights({ config }: { config?: LeadScoreConfigSummary }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      api.patch("/api/v1/leads/score-config", {
        ...Object.fromEntries(
          Object.entries(draft)
            .filter(([, v]) => v !== "")
            .map(([k, v]) => [k, Number(v)]),
        ),
      }),
    onSuccess: () => {
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.push("Scoring weights saved", "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Could not save weights", "error"),
  });

  if (!config) return null;

  const fields: { key: keyof LeadScoreConfigSummary; label: string }[] = [
    { key: "budgetAvailableWeight", label: "Budget available" },
    { key: "decisionMakerWeight", label: "Decision maker" },
    { key: "urgentRequirementWeight", label: "Urgent requirement" },
    { key: "clearRequirementWeight", label: "Clear requirement" },
    { key: "shortTimelineWeight", label: "Short timeline" },
    { key: "goodBusinessFitWeight", label: "Good business fit" },
    { key: "shortTimelineDays", label: "Short timeline is under (days)" },
    { key: "hotThreshold", label: "HOT at or above" },
    { key: "warmThreshold", label: "WARM at or above" },
  ];

  return (
    <Card>
      <h2 className="mb-1 text-sm font-medium text-ink">Lead scoring</h2>
      <p className="mb-4 text-xs text-muted">
        Every lead&apos;s 0–100 score is recomputed from these weights whenever its qualification changes.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="grid grid-cols-1 gap-3 md:grid-cols-3"
      >
        {fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-xs text-muted">
            {field.label}
            <Input
              type="number"
              min="0"
              max={field.key === "shortTimelineDays" ? "3650" : "100"}
              value={draft[field.key] ?? String(config[field.key])}
              onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
            />
          </label>
        ))}
        <div className="md:col-span-3">
          <Button type="submit" disabled={save.isPending || Object.keys(draft).length === 0}>
            {save.isPending ? "Saving…" : "Save weights"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

const MODE_LABEL: Record<AssignmentRuleMode, string> = {
  ROUND_ROBIN: "Round robin",
  TERRITORY: "Territory",
  CAPACITY: "Capacity",
};

function AssignmentRules() {
  const queryClient = useQueryClient();
  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
  });
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

  const employeeName = (id: string) => employees?.find((e) => e.id === id)?.fullName ?? id;

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

  if (!employees) return null;

  return (
    <Card>
      <h2 className="mb-1 text-sm font-medium text-ink">Assignment rules</h2>
      <p className="mb-4 text-xs text-muted">
        These rules drive both single-lead auto-assignment and the List tab&apos;s bulk assign action.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createRule.mutate();
        }}
        className="grid grid-cols-1 gap-3 md:grid-cols-4"
      >
        <Input placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input type="number" min="1" placeholder="SLA minutes" value={slaMinutes} onChange={(e) => setSlaMinutes(e.target.value)} />
        <Select value={mode} onChange={(e) => setMode(e.target.value as AssignmentRuleMode)} aria-label="Assignment mode">
          <option value="ROUND_ROBIN">Round robin</option>
          <option value="TERRITORY">Territory</option>
          <option value="CAPACITY">Capacity</option>
        </Select>
        {mode === "CAPACITY" ? (
          <Input
            type="number"
            min="0"
            placeholder="Max open leads/member"
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
          aria-label="Rule members"
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
              Map a lead&apos;s territory (matched case-insensitively) to the member who should own it. Leads with no
              match fall back to round robin across the members selected above.
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
                  aria-label="Territory owner"
                  onChange={(e) => {
                    const next = [...territoryRows];
                    next[i] = { ...next[i], employeeId: e.target.value };
                    setTerritoryRows(next);
                  }}
                >
                  <option value="">Owner…</option>
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
            {createRule.isPending ? "Creating…" : "Create rule"}
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
                  {rule.mode === "CAPACITY" && ` · cap ${rule.maxOpenLeads ?? "unlimited"}/member`}
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
