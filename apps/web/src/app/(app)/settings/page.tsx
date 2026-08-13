"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BackupRecord, BackupStatusData } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorState, Input, Spinner } from "@/components/ui";

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
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading, error: statusError } = useQuery<BackupStatusData>({
    queryKey: ["backups", "status"],
    queryFn: () => api.get<BackupStatusData>("/api/v1/backups/status"),
    refetchInterval: 30_000,
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
      <div>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="text-sm text-muted">Instance-wide configuration, visible to the Master Owner only.</p>
      </div>

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
