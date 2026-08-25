"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApiKeyCreated,
  ApiKeySummary,
  AuditEventSummary,
  BackupRecord,
  BackupStatusData,
  EmployeeSummary,
  GoogleSheetsStatusData,
} from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorState, Input, Spinner, Tabs, TabPanel, useToast } from "@/components/ui";
import { useCurrentEmployee, isMasterOwner } from "@/lib/use-current-employee";
import { ChangePasswordForm } from "@/components/change-password-form";

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
    { id: "api-keys", label: "API Keys" },
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
      <TabPanel id="api-keys" active={tab}>
        <ApiKeysTab />
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

  return (
    <Card className="max-w-sm">
      <h2 className="mb-4 text-sm font-medium text-ink">Change password</h2>
      <ChangePasswordForm onSuccess={() => push("Password updated.", "success")} />
    </Card>
  );
}

function ApiKeysTab() {
  const queryClient = useQueryClient();
  const { push } = useToast();

  const { data: keys, isLoading, error: listError } = useQuery<ApiKeySummary[]>({
    queryKey: ["api-keys"],
    queryFn: () => api.get<ApiKeySummary[]>("/api/v1/api-keys"),
  });

  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<ApiKeyCreated | null>(null);

  const createKey = useMutation({
    mutationFn: () => api.post<ApiKeyCreated>("/api/v1/api-keys", { name }),
    onSuccess: (created) => {
      setCreateError(null);
      setName("");
      setJustCreated(created);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err) => setCreateError(err instanceof ApiError ? err.message : "Could not create that key"),
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      push("Copied to clipboard.", "success");
    } catch {
      push("Could not copy — select and copy the key manually.", "error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="max-w-2xl">
        <h2 className="mb-1 text-sm font-medium text-ink">API keys</h2>
        <p className="mb-4 text-sm text-muted">
          Personal access tokens that act as you — used to connect an MCP client (Claude, ChatGPT, etc.) to
          Zulivio. See the README&apos;s &quot;MCP server&quot; section for the connection command. Anyone with a
          key can do anything your account can do, so treat it like a password and revoke it if it&apos;s ever
          exposed.
        </p>

        {justCreated && (
          <div className="mb-4 rounded-lg border border-emerald/30 bg-emerald/5 p-3">
            <p className="mb-2 text-sm font-medium text-ink">
              &quot;{justCreated.name}&quot; created — copy it now, it won&apos;t be shown again:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-surface px-2 py-1.5 text-xs">
                {justCreated.token}
              </code>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => copyToken(justCreated.token)}
              >
                Copy
              </Button>
              <button
                type="button"
                className="text-xs text-muted underline"
                onClick={() => setJustCreated(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {createError && <ErrorState message={createError} />}
        <form
          className="mb-6 flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setCreateError(null);
            createKey.mutate();
          }}
        >
          <Input
            aria-label="Key name"
            placeholder="Key name, e.g. Claude Desktop"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
            required
          />
          <Button type="submit" disabled={createKey.isPending}>
            {createKey.isPending ? "Creating..." : "Create key"}
          </Button>
        </form>

        <h3 className="mb-2 text-xs font-medium text-muted">Your keys</h3>
        {isLoading ? (
          <Spinner />
        ) : listError ? (
          <ErrorState message="Could not load your API keys." />
        ) : !keys || keys.length === 0 ? (
          <p className="text-sm text-muted">No API keys yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
              >
                <div>
                  <p className="text-ink">
                    {key.name} <span className="text-muted">(····{key.lastFour})</span>
                  </p>
                  <p className="text-xs text-muted">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                    {key.lastUsedAt && ` · last used ${new Date(key.lastUsedAt).toLocaleString()}`}
                  </p>
                </div>
                {key.revokedAt ? (
                  <Badge tone="neutral">Revoked</Badge>
                ) : (
                  <Button
                    variant="danger"
                    className="px-3 py-1.5 text-xs"
                    disabled={revokeKey.isPending}
                    onClick={() => revokeKey.mutate(key.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
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

  const toast = useToast();
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadConfirmText, setUploadConfirmText] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const restoreUpload = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error("Choose a backup file first");
      return api.upload("/api/v1/backups/restore-upload", uploadFile, { confirm: uploadConfirmText });
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadConfirmText("");
      setUploadError(null);
      toast.push("Restored from the uploaded backup.", "success");
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (err) => setUploadError(err instanceof ApiError ? err.message : "Restore failed"),
  });

  const { data: version } = useQuery<{
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    releaseUrl: string | null;
  }>({
    queryKey: ["system", "version"],
    queryFn: () => api.get("/api/v1/system/version"),
    staleTime: 5 * 60 * 1000,
  });
  const [applying, setApplying] = useState(false);
  const [applyConfirming, setApplyConfirming] = useState(false);
  const applyUpdate = useMutation({
    mutationFn: () => api.post<{ status: string; message: string }>("/api/v1/system/update/apply"),
    onSuccess: (result) => {
      toast.push(result.message, "success");
      const start = Date.now();
      const poll = setInterval(async () => {
        if (Date.now() - start > 3 * 60 * 1000) {
          clearInterval(poll);
          toast.push("Still not back after 3 minutes — check the server directly.", "error");
          return;
        }
        try {
          const res = await fetch("/api/health/live", { cache: "no-store" });
          if (res.ok) {
            clearInterval(poll);
            window.location.reload();
          }
        } catch {
          // expected while the container is restarting
        }
      }, 3000);
    },
    onError: (err) => {
      setApplying(false);
      toast.push(err instanceof ApiError ? err.message : "Could not start the update", "error");
    },
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
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => triggerBackup.mutate()} disabled={triggerBackup.isPending}>
                {triggerBackup.isPending ? "Backing up..." : "Back up now"}
              </Button>
              <a href="/api/v1/backups/download">
                <Button variant="secondary">Download backup</Button>
              </a>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <h3 className="text-xs font-medium text-muted">Restore from a local file</h3>
              {uploadError && <ErrorState message={uploadError} />}
              <input
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="text-sm text-muted"
              />
              {uploadFile && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-coral">
                    This overwrites the entire database and uploaded files with this file&apos;s contents, for
                    every organization on this instance. This cannot be undone. Type{" "}
                    <code className="rounded bg-canvas px-1">RESTORE</code> to confirm.
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-40"
                      value={uploadConfirmText}
                      onChange={(e) => setUploadConfirmText(e.target.value)}
                      placeholder="RESTORE"
                    />
                    <Button
                      variant="danger"
                      disabled={uploadConfirmText !== "RESTORE" || restoreUpload.isPending}
                      onClick={() => restoreUpload.mutate()}
                    >
                      {restoreUpload.isPending ? "Restoring..." : "Confirm restore"}
                    </Button>
                    <button
                      type="button"
                      className="text-xs text-muted underline"
                      onClick={() => {
                        setUploadFile(null);
                        setUploadConfirmText("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
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

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">Application update</h2>
          {version && (
            <Badge tone={version.updateAvailable ? "success" : "neutral"}>
              {version.updateAvailable ? "Update available" : "Up to date"}
            </Badge>
          )}
        </div>
        {version ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Running <span className="text-ink">{version.currentVersion}</span>
              {version.latestVersion && (
                <>
                  {" "}
                  · latest is <span className="text-ink">{version.latestVersion}</span>
                </>
              )}
            </p>
            {version.currentVersion === "dev" && (
              <p className="text-xs text-muted">
                Running a dev build — can&apos;t tell if you&apos;re behind the latest release, but you can still
                pull and rebuild from the latest commit on <code className="rounded bg-canvas px-1">main</code>.
              </p>
            )}
            {version.releaseUrl && (
              <a href={version.releaseUrl} target="_blank" rel="noreferrer" className="text-xs text-muted underline">
                View release notes
              </a>
            )}
            {(version.updateAvailable || version.currentVersion === "dev") && !applyConfirming && (
              <div>
                <Button onClick={() => setApplyConfirming(true)}>
                  {version.updateAvailable ? "Update now" : "Pull latest & rebuild"}
                </Button>
              </div>
            )}
            {applyConfirming && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-xs text-coral">
                  This pulls the latest {version.updateAvailable ? "release" : "commit on main"} and
                  rebuilds/restarts every service. The app will be briefly unreachable while it restarts — this
                  page reloads automatically once it&apos;s back.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="danger"
                    disabled={applying}
                    onClick={() => {
                      setApplying(true);
                      applyUpdate.mutate();
                    }}
                  >
                    {applying ? "Updating..." : "Confirm update"}
                  </Button>
                  <button
                    type="button"
                    className="text-xs text-muted underline"
                    onClick={() => setApplyConfirming(false)}
                    disabled={applying}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Spinner />
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
