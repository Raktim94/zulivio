"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { ArrowRight, Download } from "lucide-react";
import { Badge, Button, Card, ErrorState, FileInput, Input, Skeleton, Spinner, useConfirm, useToast } from "@/components/ui";
import { isManagerOrAbove } from "@/lib/use-current-employee";
import { useRequireRole } from "@/lib/use-require-role";

interface ImportResult {
  createdCount: number;
  errorCount: number;
  errors: { row: number; message: string }[];
  detectedHeaders?: string[];
}

export default function DataHubPage() {
  const { isLoading: authLoading, authorized } = useRequireRole(isManagerOrAbove);
  const { data: sheetsStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["integrations", "google-sheets", "status"],
    queryFn: () => api.get("/api/v1/integrations/google-sheets/status"),
    enabled: authorized,
  });

  if (authLoading) return <Spinner />;
  if (!authorized) return null; // redirecting

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-ink">Data Hub</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          See how your records connect, spot the gaps, then import or export each type in one place.
        </p>
      </div>

      <RelationsMap />

      <section aria-labelledby="entities-heading" className="flex flex-col gap-3">
        <h2 id="entities-heading" className="text-sm font-semibold text-ink">Import and export</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <EntityCard
            title="Employees"
            exportPath="/api/v1/exports/employees.csv"
            importEndpoint="/api/v1/imports/employees/csv"
            hint={
              <>
                Needs <code className="rounded bg-canvas px-1">full_name</code> and{" "}
                <code className="rounded bg-canvas px-1">email</code>. Optional:{" "}
                <code className="rounded bg-canvas px-1">role</code>,{" "}
                <code className="rounded bg-canvas px-1">department</code>.
              </>
            }
          />
          <EntityCard
            title="Leads"
            exportPath="/api/v1/exports/leads.csv"
            importEndpoint="/api/v1/imports/leads/csv"
            hint={
              <>
                Needs <code className="rounded bg-canvas px-1">full_name</code> or{" "}
                <code className="rounded bg-canvas px-1">company</code>. Optional:{" "}
                <code className="rounded bg-canvas px-1">email</code>,{" "}
                <code className="rounded bg-canvas px-1">phone</code>,{" "}
                <code className="rounded bg-canvas px-1">source</code>. Other columns are kept as custom fields.
              </>
            }
            footer={<Link href="/leads" className="text-emerald underline">Also available on the Leads page</Link>}
          />
          <EntityCard
            title="Opportunities"
            exportPath="/api/v1/exports/opportunities.csv"
            importEndpoint="/api/v1/imports/opportunities/csv"
            hint={
              <>
                Needs <code className="rounded bg-canvas px-1">title</code>. Optional:{" "}
                <code className="rounded bg-canvas px-1">company</code>,{" "}
                <code className="rounded bg-canvas px-1">amount</code> (e.g. 1500.00) or{" "}
                <code className="rounded bg-canvas px-1">amountMinor</code>,{" "}
                <code className="rounded bg-canvas px-1">expectedCloseDate</code>. Lands in the default pipeline&apos;s
                first stage.
              </>
            }
          />
          <EntityCard title="Assignments" exportPath="/api/v1/exports/assignments.csv" />
        </div>
      </section>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Google Sheets sync</h2>
          <span className={`text-xs font-medium ${sheetsStatus?.configured ? "text-emerald-dark" : "text-muted"}`}>
            {sheetsStatus?.configured ? "Connected" : "Not configured"}
          </span>
        </div>
        {!sheetsStatus?.configured ? (
          <p className="text-sm text-muted">
            Set <code className="rounded bg-canvas px-1">GOOGLE_SHEETS_CLIENT_EMAIL</code> and{" "}
            <code className="rounded bg-canvas px-1">GOOGLE_SHEETS_PRIVATE_KEY</code> (a Google service
            account) on the backend, then share your spreadsheet with that service account&apos;s email,
            to enable live import/export.
          </p>
        ) : (
          <GoogleSheetsSyncForm />
        )}
      </Card>

      <DeleteAllLeadsCard />
    </div>
  );
}

function DeleteAllLeadsCard() {
  const toast = useToast();
  const ask = useConfirm();
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<{ matched: number; deleted: number } | null>(null);

  const deleteAll = useMutation({
    mutationFn: () =>
      api.post<{ matched: number; deleted: number }>("/api/v1/leads/bulk/delete-all", { acknowledge: true }),
    onSuccess: (res) => {
      setResult(res);
      setConfirmText("");
      toast.push(`${res.deleted} lead${res.deleted === 1 ? "" : "s"} deleted`, "success");
    },
    onError: (err) => toast.push(err instanceof ApiError ? err.message : "Delete failed", "error"),
  });

  return (
    <Card className="border-coral/40 bg-coral/5">
      <h2 className="mb-2 text-sm font-medium text-coral">Danger zone: delete all leads</h2>
      <p className="mb-4 text-sm text-muted">
        Permanently removes every lead currently visible to you — for an org-wide role that&apos;s every lead in the
        organization, for a manager that&apos;s your team&apos;s leads — along with their activity and follow-ups.
        This can&apos;t be undone. Use it to clear test or demo data; for cleaning up one bad batch, prefer the{" "}
        <Link href="/leads" className="underline">Leads</Link> list&apos;s filtered bulk delete instead, which stays
        scoped to what you&apos;ve filtered for.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Type DELETE to confirm
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-48"
            aria-label="Type DELETE to confirm"
          />
        </label>
        <Button
          variant="danger"
          disabled={confirmText !== "DELETE" || deleteAll.isPending}
          onClick={async () => {
            if (await ask({ title: "Delete all leads?", message: "Every lead visible to you is permanently deleted, with its call and note history. This can't be undone.", confirmLabel: "Delete all leads" })) {
              deleteAll.mutate();
            }
          }}
        >
          {deleteAll.isPending ? "Deleting…" : "Delete all leads"}
        </Button>
      </div>
      {result && (
        <p className="mt-3 text-sm text-ink">
          {result.deleted} lead{result.deleted === 1 ? "" : "s"} deleted.
        </p>
      )}
    </Card>
  );
}

interface Overview {
  entities: { employees: number; leads: number; opportunities: number; assignments: number; pipelines: number };
  links: {
    leadsOwned: number;
    leadsConverted: number;
    opportunitiesFromLeads: number;
    assignmentsOnLeads: number;
    assignmentsOnOpportunities: number;
    assignmentsOwned: number;
    opportunitiesOwned: number;
    opportunitiesInPipeline: number;
  };
  attention: { leadsUnowned: number; assignmentsUnlinked: number };
}

function RelationsMap() {
  const { data, isLoading, isError } = useQuery<Overview>({
    queryKey: ["data-hub", "overview"],
    queryFn: () => api.get("/api/v1/data/overview"),
  });

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }
  if (isError || !data) return <ErrorState message="Couldn't load the relations overview. Refresh to try again." />;

  const { entities: e, links: l, attention: a } = data;
  const nodes = [
    { label: "Employees", count: e.employees, href: "/employees" },
    { label: "Leads", count: e.leads, href: "/leads" },
    { label: "Opportunities", count: e.opportunities, href: "/pipeline" },
    { label: "Assignments", count: e.assignments, href: "/assignments" },
  ];
  const relations = [
    { from: "Employee", to: "Lead", verb: "owns", value: l.leadsOwned, total: e.leads, href: "/leads" },
    { from: "Lead", to: "Opportunity", verb: "converted into", value: l.leadsConverted, total: e.leads, href: "/pipeline" },
    { from: "Employee", to: "Opportunity", verb: "owns", value: l.opportunitiesOwned, total: e.opportunities, href: "/pipeline" },
    { from: "Employee", to: "Assignment", verb: "owns", value: l.assignmentsOwned, total: e.assignments, href: "/assignments" },
    { from: "Assignment", to: "Lead", verb: "linked to", value: l.assignmentsOnLeads, total: e.assignments, href: "/assignments" },
    { from: "Assignment", to: "Opportunity", verb: "linked to", value: l.assignmentsOnOpportunities, total: e.assignments, href: "/assignments" },
  ];
  const issues = [
    a.leadsUnowned > 0 && { text: `${a.leadsUnowned} lead${a.leadsUnowned === 1 ? "" : "s"} with no owner`, href: "/leads" },
    a.assignmentsUnlinked > 0 && {
      text: `${a.assignmentsUnlinked} assignment${a.assignmentsUnlinked === 1 ? "" : "s"} not linked to a lead or opportunity`,
      href: "/assignments",
    },
  ].filter(Boolean) as { text: string; href: string }[];

  return (
    <section aria-labelledby="relations-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="relations-heading" className="text-sm font-semibold text-ink">How your data connects</h2>
        {issues.length === 0 ? <Badge tone="success">All records linked</Badge> : <Badge tone="warning">{issues.length} to review</Badge>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {nodes.map((n) => (
          <Link
            key={n.label}
            href={n.href}
            className="group rounded-xl border border-border bg-surface p-4 transition-colors hover:border-emerald"
          >
            <p className="text-xs text-muted">{n.label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{n.count.toLocaleString()}</p>
          </Link>
        ))}
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-border">
          {relations.map((r) => {
            const pct = r.total > 0 ? Math.round((r.value / r.total) * 100) : 0;
            return (
              <li key={`${r.from}-${r.verb}-${r.to}`}>
                <Link href={r.href} className="flex flex-col gap-2 px-5 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:gap-4">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-ink sm:w-80">
                    <span className="font-medium">{r.from}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="text-muted">{r.verb}</span>
                    <span className="font-medium">{r.to}</span>
                  </span>
                  <span
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${r.from} ${r.verb} ${r.to}`}
                  >
                    <span className="block h-full rounded-full bg-emerald" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-sm text-muted sm:w-40 sm:text-right">
                    {r.value.toLocaleString()} of {r.total.toLocaleString()} · {pct}%
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>

      {issues.length > 0 && (
        <ul className="flex flex-col gap-2">
          {issues.map((i) => (
            <li key={i.text}>
              <Link
                href={i.href}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber/5 px-4 py-3 text-sm text-ink hover:bg-amber/10"
              >
                <span>{i.text}</span>
                <span className="inline-flex items-center gap-1 text-amber">Review <ArrowRight className="h-3.5 w-3.5" aria-hidden /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EntityCard({
  title,
  exportPath,
  importEndpoint,
  hint,
  footer,
}: {
  title: string;
  exportPath: string;
  importEndpoint?: string;
  hint?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importCsv = useMutation({
    mutationFn: () => {
      if (!file || !importEndpoint) throw new Error("Choose a CSV file first");
      return api.upload<ImportResult>(importEndpoint, file);
    },
    onSuccess: setResult,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Import failed"),
  });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <a href={exportPath} download>
          <Button variant="secondary" type="button">
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </Button>
        </a>
      </div>
      {importEndpoint ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            setResult(null);
            importCsv.mutate();
          }}
          className="flex flex-col items-start gap-3 border-t border-border pt-4"
        >
          {hint && <p className="text-xs text-muted">{hint}</p>}
          {error && <div className="w-full"><ErrorState message={error} /></div>}
          <FileInput value={file} onChange={setFile} accept=".csv,text/csv" label="Choose CSV file" required />
          <Button type="submit" disabled={!file || importCsv.isPending}>
            {importCsv.isPending ? "Importing…" : "Import"}
          </Button>
        </form>
      ) : (
        <p className="border-t border-border pt-4 text-xs text-muted">Export only. Assignments are created in the app.</p>
      )}
      {result && (
        <div className="text-sm" aria-live="polite">
          <p className="font-medium text-ink">
            {result.createdCount} created, {result.errorCount} errors
          </p>
          {result.errors.length > 0 && (
            <>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-coral">
                {result.errors.map((er, i) => (
                  <li key={i}>Row {er.row}: {er.message}</li>
                ))}
              </ul>
              {result.detectedHeaders && (
                <p className="mt-2 text-xs text-muted">
                  Columns detected in your file: {result.detectedHeaders.join(", ") || "none"}
                </p>
              )}
            </>
          )}
        </div>
      )}
      {footer && <p className="text-xs">{footer}</p>}
    </Card>
  );
}

function GoogleSheetsSyncForm() {
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [range, setRange] = useState("Sheet1!A1:F");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | { ok: true } | null>(null);

  const exportSheet = useMutation({
    mutationFn: () =>
      api.post("/api/v1/integrations/google-sheets/export", { spreadsheetId, range, object: "employees" }),
    onSuccess: () => setResult({ ok: true }),
    onError: (err) => setError(err instanceof ApiError ? err.message : "Export failed"),
  });

  const importSheet = useMutation({
    mutationFn: () =>
      api.post<ImportResult>("/api/v1/integrations/google-sheets/import", {
        spreadsheetId,
        range,
        object: "employees",
      }),
    onSuccess: setResult,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Import failed"),
  });

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorState message={error} />}
      <Input placeholder="Spreadsheet ID" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} />
      <Input placeholder="Range, e.g. Sheet1!A1:F" value={range} onChange={(e) => setRange(e.target.value)} />
      <div className="flex gap-3">
        <Button
          variant="secondary"
          disabled={!spreadsheetId || exportSheet.isPending}
          onClick={() => {
            setError(null);
            exportSheet.mutate();
          }}
        >
          {exportSheet.isPending ? "Exporting..." : "Live export to Sheet"}
        </Button>
        <Button
          disabled={!spreadsheetId || importSheet.isPending}
          onClick={() => {
            setError(null);
            importSheet.mutate();
          }}
        >
          {importSheet.isPending ? "Importing..." : "Import from Sheet"}
        </Button>
      </div>
      {result && "ok" in result && <p className="text-sm text-emerald-dark">Done.</p>}
      {result && "createdCount" in result && (
        <p className="text-sm text-ink">
          {result.createdCount} created, {result.errorCount} errors
        </p>
      )}
    </div>
  );
}
