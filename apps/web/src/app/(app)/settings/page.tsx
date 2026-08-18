"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuditEventSummary,
  BackupRecord,
  BackupStatusData,
  EmployeeSummary,
  GoogleSheetsStatusData,
} from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorState, Input, Spinner, Tabs, TabPanel, useToast } from "@/components/ui";
import { useCurrentEmployee, isMasterOwner } from "@/lib/use-current-employee";

const STATUS_TONE: Record<BackupRecord["status"], "neutral" | "success" | "warning" | "danger" | "info"> = {
  PENDING: "info",
  UPLOADING: "info",
  VERIFIED: "success",
  FAILED: "danger",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SettingsPage() {
  const { data: employee, isLoading: employeeLoading } = useCurrentEmployee();
  const [tab, setTab] = useState("profile");
  const owner = isMasterOwner(employee?.role);

  if (employeeLoading || !employee) return <Spinner />;

  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "team", label: "Team" },
    { id: "password", label: "Password" },
    ...(owner ? [{ id: "backups", label: "Backups & Activity" }] : []),
    ...(owner ? [{ id: "integrations", label: "Integrations" }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="text-sm text-muted">Your profile, team visibility, and account security.</p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <TabPanel id="profile" active={tab}>
        <ProfileTab employee={employee} />
      </TabPanel>
      <TabPanel id="team" active={tab}>
        <TeamTab />
      </TabPanel>
      <TabPanel id="password" active={tab}>
        <PasswordTab />
      </TabPanel>
      {owner && (
        <TabPanel id="backups" active={tab}>
          <BackupsAndActivityTab />
        </TabPanel>
      )}
      {owner && (
        <TabPanel id="integrations" active={tab}>
          <IntegrationsTab />
        </TabPanel>
      )}
    </div>
  );
}

function ProfileTab({ employee }: { employee: { fullName: string; email: string; role: string; employmentStatus: string } }) {
  return (
    <Card className="max-w-lg">
      <h2 className="mb-4 text-sm font-medium text-ink">Your profile</h2>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">Full name</dt>
          <dd className="text-ink">{employee.fullName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Email</dt>
          <dd className="text-ink">{employee.email}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Role</dt>
          <dd className="text-ink">{employee.role.replace(/_/g, " ")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Status</dt>
          <dd className="text-ink">{employee.employmentStatus}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted">
        Name, department, and role changes are made by a manager from the Employees page.
      </p>
    </Card>
  );
}

function TeamTab() {
  const { data, isLoading, error } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message="Could not load your team." />;

  return (
    <Card>
      <h2 className="mb-4 text-sm font-medium text-ink">Your team</h2>
      <p className="mb-4 text-sm text-muted">
        Everyone visible to you, based on your role and reporting line.
      </p>
      <ul className="flex flex-col gap-2">
        {data.map((e) => (
          <li key={e.id} className="flex items-center justify-between border-t border-border py-2 text-sm first:border-t-0 first:pt-0">
            <span className="text-ink">
              {e.fullName} <span className="text-muted">({e.employeeNumber})</span>
            </span>
            <Badge tone="neutral">{e.role.replace(/_/g, " ")}</Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PasswordTab() {
  const { push } = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [error, setError] = useState<string | null>(null);

  const changePassword = useMutation({
    mutationFn: () => api.post("/api/v1/auth/change-password", form),
    onSuccess: () => {
      setError(null);
      setForm({ currentPassword: "", newPassword: "" });
      push("Password updated.", "success");
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not change your password"),
  });

  return (
    <Card className="max-w-sm">
      <h2 className="mb-4 text-sm font-medium text-ink">Change password</h2>
      {error && <ErrorState message={error} />}
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          changePassword.mutate();
        }}
      >
        <Input
          type="password"
          placeholder="Current password"
          value={form.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
          required
        />
        <Input
          type="password"
          placeholder="New password"
          value={form.newPassword}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          minLength={8}
          required
        />
        <Button type="submit" disabled={changePassword.isPending}>
          {changePassword.isPending ? "Updating..." : "Update password"}
        </Button>
      </form>
    </Card>
  );
}

function BackupsAndActivityTab() {
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading, error: statusError } = useQuery<BackupStatusData>({
    queryKey: ["backups", "status"],
    queryFn: () => api.get<BackupStatusData>("/api/v1/backups/status"),
    refetchInterval: 30_000,
  });

  const { data: auditEvents, isLoading: auditLoading, error: auditError } = useQuery<AuditEventSummary[]>({
    queryKey: ["audit-events"],
    queryFn: () => api.get<AuditEventSummary[]>("/api/v1/audit-events"),
  });

  const { data: history } = useQuery<BackupRecord[]>({
    queryKey: ["backups", "list"],
    queryFn: () => api.get<BackupRecord[]>("/api/v1/backups"),
    refetchInterval: 30_000,
  });

  const [showConfigForm, setShowConfigForm] = useState(false);
  const [configForm, setConfigForm] = useState({
    endpoint: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    region: "auto",
    intervalDays: "3",
    retainCount: "2",
  });
  const [configError, setConfigError] = useState<string | null>(null);

  const saveConfig = useMutation({
    mutationFn: () =>
      api.post("/api/v1/backups/config", {
        ...configForm,
        intervalDays: Number(configForm.intervalDays),
        retainCount: Number(configForm.retainCount),
      }),
    onSuccess: () => {
      setConfigError(null);
      setShowConfigForm(false);
      setConfigForm((f) => ({ ...f, secretAccessKey: "" }));
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => setConfigError(err instanceof ApiError ? err.message : "Could not save that connection"),
  });

  const clearConfig = useMutation({
    mutationFn: () => api.delete("/api/v1/backups/config"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });

  const [triggerError, setTriggerError] = useState<string | null>(null);
  const triggerBackup = useMutation({
    mutationFn: () => api.post("/api/v1/backups"),
    onSuccess: () => {
      setTriggerError(null);
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => setTriggerError(err instanceof ApiError ? err.message : "Backup failed"),
  });

  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreBackup = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/backups/${id}/restore`, { confirm: confirmText }),
    onSuccess: () => {
      setRestoreTargetId(null);
      setConfirmText("");
      setRestoreError(null);
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => setRestoreError(err instanceof ApiError ? err.message : "Restore failed"),
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Backups</h2>
          {status && (
            <span className={`text-xs font-medium ${status.configured ? "text-emerald-dark" : "text-muted"}`}>
              {status.configured ? "Configured" : "Not configured"}
            </span>
          )}
        </div>

        {statusLoading ? (
          <Spinner />
        ) : statusError || !status ? (
          <ErrorState message="Could not load backup status." />
        ) : !status.configured || showConfigForm ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Connect any S3-compatible bucket to enable automatic backups of the full database and uploaded
              files. Runs on its own schedule from here on — no other setup needed once connected.
            </p>
            {configError && <ErrorState message={configError} />}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setConfigError(null);
                saveConfig.mutate();
              }}
              className="grid grid-cols-1 gap-3 md:grid-cols-2"
            >
              <Input
                placeholder="Endpoint URL, e.g. https://s3.example.com"
                value={configForm.endpoint}
                onChange={(e) => setConfigForm({ ...configForm, endpoint: e.target.value })}
                required
              />
              <Input
                placeholder="Bucket"
                value={configForm.bucket}
                onChange={(e) => setConfigForm({ ...configForm, bucket: e.target.value })}
                required
              />
              <Input
                placeholder="Access key ID"
                value={configForm.accessKeyId}
                onChange={(e) => setConfigForm({ ...configForm, accessKeyId: e.target.value })}
                required
              />
              <Input
                type="password"
                placeholder="Secret access key"
                value={configForm.secretAccessKey}
                onChange={(e) => setConfigForm({ ...configForm, secretAccessKey: e.target.value })}
                required
              />
              <Input
                placeholder="Region (optional, default auto)"
                value={configForm.region}
                onChange={(e) => setConfigForm({ ...configForm, region: e.target.value })}
              />
              <div className="flex gap-3">
                <Input
                  type="number"
                  min="1"
                  max="30"
                  placeholder="Backup every N days"
                  value={configForm.intervalDays}
                  onChange={(e) => setConfigForm({ ...configForm, intervalDays: e.target.value })}
                />
                <Input
                  type="number"
                  min="1"
                  max="10"
                  placeholder="Keep N backups"
                  value={configForm.retainCount}
                  onChange={(e) => setConfigForm({ ...configForm, retainCount: e.target.value })}
                />
              </div>
              <div className="flex gap-3 md:col-span-2">
                <Button type="submit" disabled={saveConfig.isPending}>
                  {saveConfig.isPending ? "Testing connection..." : "Connect & save"}
                </Button>
                {status.configured && (
                  <button
                    type="button"
                    className="text-xs text-muted underline"
                    onClick={() => setShowConfigForm(false)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
              <div>
                <p className="text-ink">
                  {status.bucket} <span className="text-muted">at {status.endpoint}</span>
                </p>
                <p className="text-xs text-muted">
                  Key {status.accessKeyIdMasked} ·{" "}
                  {status.source === "environment" ? "configured via CasaOS/environment" : "configured in Settings"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => {
                    setConfigForm((f) => ({
                      ...f,
                      endpoint: status.endpoint ?? "",
                      bucket: status.bucket ?? "",
                      region: status.region ?? "auto",
                      intervalDays: String(status.intervalDays),
                      retainCount: String(status.retainCount),
                    }));
                    setShowConfigForm(true);
                  }}
                >
                  Change
                </Button>
                {status.source === "database" && (
                  <Button
                    variant="danger"
                    className="px-3 py-1.5 text-xs"
                    disabled={clearConfig.isPending}
                    onClick={() => clearConfig.mutate()}
                  >
                    Disconnect
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Runs every" value={`${status.intervalDays} days`} />
              <Stat label="Keeps" value={`${status.retainCount} backups`} />
              <Stat
                label="Last backup"
                value={status.lastBackup ? new Date(status.lastBackup.startedAt).toLocaleString() : "Never"}
              />
              <Stat
                label="Next scheduled"
                value={status.nextScheduledAt ? new Date(status.nextScheduledAt).toLocaleString() : "—"}
              />
            </div>

            {triggerError && <ErrorState message={triggerError} />}
            <div>
              <Button onClick={() => triggerBackup.mutate()} disabled={triggerBackup.isPending}>
                {triggerBackup.isPending ? "Backing up..." : "Back up now"}
              </Button>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium text-muted">History</h3>
              {!history || history.length === 0 ? (
                <p className="text-sm text-muted">No backups yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {history.map((b) => (
                    <li key={b.id} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {new Date(b.startedAt).toLocaleString()}{" "}
                          <span className="text-muted">
                            · {formatBytes(b.sizeBytes)} · triggered by {b.triggeredBy === "schedule" ? "schedule" : "manual"}
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>
                          {b.status === "VERIFIED" && (
                            <Button
                              variant="danger"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => {
                                setRestoreTargetId(b.id);
                                setConfirmText("");
                                setRestoreError(null);
                              }}
                            >
                              Restore
                            </Button>
                          )}
                        </div>
                      </div>
                      {b.error && <p className="mt-2 text-xs text-coral">{b.error}</p>}

                      {restoreTargetId === b.id && (
                        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                          <p className="text-xs text-coral">
                            This overwrites the entire database and uploaded files with this backup&apos;s
                            contents, for every organization on this instance. This cannot be undone. Type{" "}
                            <code className="rounded bg-canvas px-1">RESTORE</code> to confirm.
                          </p>
                          {restoreError && <ErrorState message={restoreError} />}
                          <div className="flex items-center gap-2">
                            <Input
                              className="w-40"
                              value={confirmText}
                              onChange={(e) => setConfirmText(e.target.value)}
                              placeholder="RESTORE"
                            />
                            <Button
                              variant="danger"
                              disabled={confirmText !== "RESTORE" || restoreBackup.isPending}
                              onClick={() => restoreBackup.mutate(b.id)}
                            >
                              {restoreBackup.isPending ? "Restoring..." : "Confirm restore"}
                            </Button>
                            <button
                              type="button"
                              className="text-xs text-muted underline"
                              onClick={() => setRestoreTargetId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Activity log</h2>
        <p className="mb-4 text-sm text-muted">
          Who did what — employee changes, password resets, exports, and more. Master Owner only.
        </p>
        {auditLoading ? (
          <Spinner />
        ) : auditError || !auditEvents ? (
          <ErrorState message="Could not load the activity log." />
        ) : auditEvents.length === 0 ? (
          <p className="text-sm text-muted">No activity recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {auditEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm first:border-t-0 first:pt-0">
                <span>
                  <span className="text-ink">{e.actor?.fullName ?? "System"}</span>{" "}
                  <span className="text-muted">
                    {e.action.replace(/_/g, " ").replace(/\./g, " ")} · {e.targetType}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function IntegrationsTab() {
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading, error: statusError } = useQuery<GoogleSheetsStatusData>({
    queryKey: ["integrations", "google-sheets", "status"],
    queryFn: () => api.get<GoogleSheetsStatusData>("/api/v1/integrations/google-sheets/status"),
  });

  const [showConfigForm, setShowConfigForm] = useState(false);
  const [configForm, setConfigForm] = useState({ clientEmail: "", privateKey: "" });
  const [configError, setConfigError] = useState<string | null>(null);

  const saveConfig = useMutation({
    mutationFn: () => api.post("/api/v1/integrations/google-sheets/config", configForm),
    onSuccess: () => {
      setConfigError(null);
      setShowConfigForm(false);
      setConfigForm({ clientEmail: "", privateKey: "" });
      queryClient.invalidateQueries({ queryKey: ["integrations", "google-sheets"] });
    },
    onError: (err) => setConfigError(err instanceof ApiError ? err.message : "Could not save that service account"),
  });

  const clearConfig = useMutation({
    mutationFn: () => api.delete("/api/v1/integrations/google-sheets/config"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrations", "google-sheets"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Google Sheets</h2>
          {status && (
            <span className={`text-xs font-medium ${status.configured ? "text-emerald-dark" : "text-muted"}`}>
              {status.configured ? "Configured" : "Not configured"}
            </span>
          )}
        </div>

        {statusLoading ? (
          <Spinner />
        ) : statusError || !status ? (
          <ErrorState message="Could not load Google Sheets status." />
        ) : !status.configured || showConfigForm ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Connect a Google service account to enable Sheets import/export. Create one in Google Cloud, enable
              the Sheets API, and share your target spreadsheet with the service account&apos;s email — CSV
              import/export keeps working without this.
            </p>
            {configError && <ErrorState message={configError} />}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setConfigError(null);
                saveConfig.mutate();
              }}
              className="flex flex-col gap-3"
            >
              <Input
                aria-label="Service account email"
                type="email"
                placeholder="Service account email"
                value={configForm.clientEmail}
                onChange={(e) => setConfigForm({ ...configForm, clientEmail: e.target.value })}
                required
              />
              <textarea
                aria-label="Private key"
                className="min-h-32 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
                placeholder="Private key (including -----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----)"
                value={configForm.privateKey}
                onChange={(e) => setConfigForm({ ...configForm, privateKey: e.target.value })}
                required
              />
              <div className="flex gap-3">
                <Button type="submit" disabled={saveConfig.isPending}>
                  {saveConfig.isPending ? "Verifying..." : "Connect & save"}
                </Button>
                {status.configured && (
                  <button
                    type="button"
                    className="text-xs text-muted underline"
                    onClick={() => setShowConfigForm(false)}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
            <div>
              <p className="text-ink">{status.clientEmail}</p>
              <p className="text-xs text-muted">
                {status.source === "environment" ? "configured via CasaOS/environment" : "configured in Settings"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setShowConfigForm(true)}>
                Change
              </Button>
              {status.source === "database" && (
                <Button
                  variant="danger"
                  className="px-3 py-1.5 text-xs"
                  disabled={clearConfig.isPending}
                  onClick={() => clearConfig.mutate()}
                >
                  Disconnect
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}
