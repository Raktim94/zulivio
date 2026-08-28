"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button, Card, ErrorState, FileInput, Input, Spinner } from "@/components/ui";
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Data Hub</h1>
        <p className="text-sm text-muted">
          CSV and Google Sheets import/export for employees, assignments, leads, and opportunities. This same lead
          importer is also available on the <Link href="/leads" className="text-emerald underline">Leads</Link> page,
          next to lead management.
        </p>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">CSV export</h2>
        <div className="flex flex-wrap gap-3">
          <a href="/api/v1/exports/employees.csv">
            <Button variant="secondary">Export employees.csv</Button>
          </a>
          <a href="/api/v1/exports/assignments.csv">
            <Button variant="secondary">Export assignments.csv</Button>
          </a>
          <a href="/api/v1/exports/leads.csv">
            <Button variant="secondary">Export leads.csv</Button>
          </a>
          <a href="/api/v1/exports/opportunities.csv">
            <Button variant="secondary">Export opportunities.csv</Button>
          </a>
        </div>
      </Card>

      <CsvImportCard
        title="Import employees from CSV"
        endpoint="/api/v1/imports/employees/csv"
        hint={
          <>
            Header row must include <code className="rounded bg-canvas px-1">full_name</code>,{" "}
            <code className="rounded bg-canvas px-1">email</code>, and optionally{" "}
            <code className="rounded bg-canvas px-1">role</code>, <code className="rounded bg-canvas px-1">department</code>.
          </>
        }
      />

      <CsvImportCard
        title="Import leads from CSV"
        endpoint="/api/v1/imports/leads/csv"
        hint={
          <>
            Header row must include <code className="rounded bg-canvas px-1">full_name</code> or{" "}
            <code className="rounded bg-canvas px-1">company</code> (used as the lead name if{" "}
            <code className="rounded bg-canvas px-1">full_name</code> is blank), and optionally{" "}
            <code className="rounded bg-canvas px-1">email</code>, <code className="rounded bg-canvas px-1">phone</code>,{" "}
            <code className="rounded bg-canvas px-1">source</code>. Any other columns are kept as custom fields.
          </>
        }
      />

      <CsvImportCard
        title="Import opportunities from CSV"
        endpoint="/api/v1/imports/opportunities/csv"
        hint={
          <>
            Header row must include <code className="rounded bg-canvas px-1">title</code>, and optionally{" "}
            <code className="rounded bg-canvas px-1">company</code>,{" "}
            <code className="rounded bg-canvas px-1">amount</code> (major currency units, e.g. 1500.00) or{" "}
            <code className="rounded bg-canvas px-1">amountMinor</code>,{" "}
            <code className="rounded bg-canvas px-1">expectedCloseDate</code>. Lands in the default pipeline&apos;s
            first stage.
          </>
        }
      />

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
    </div>
  );
}

function CsvImportCard({
  title,
  endpoint,
  hint,
}: {
  title: string;
  endpoint: string;
  hint: React.ReactNode;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importCsv = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Choose a CSV file first");
      return api.upload<ImportResult>(endpoint, file);
    },
    onSuccess: setResult,
    onError: (err) => setError(err instanceof ApiError ? err.message : "Import failed"),
  });

  return (
    <Card>
      <h2 className="mb-4 text-sm font-medium text-ink">{title}</h2>
      <p className="mb-3 text-xs text-muted">{hint}</p>
      {error && <div className="mb-3"><ErrorState message={error} /></div>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setResult(null);
          importCsv.mutate();
        }}
        className="flex flex-col items-start gap-3"
      >
        <FileInput value={file} onChange={setFile} accept=".csv,text/csv" label="Choose CSV file" required />
        <Button type="submit" disabled={!file || importCsv.isPending}>
          {importCsv.isPending ? "Importing..." : "Import"}
        </Button>
      </form>
      {result && (
        <div className="mt-4 text-sm">
          <p className="font-medium text-ink">
            {result.createdCount} created, {result.errorCount} errors
          </p>
          {result.errors.length > 0 && (
            <>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-coral">
                {result.errors.map((e, i) => (
                  <li key={i}>Row {e.row}: {e.message}</li>
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
