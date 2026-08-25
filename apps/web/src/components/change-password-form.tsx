"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorState, Input } from "@/components/ui";

export function ChangePasswordForm({
  submitLabel = "Update password",
  onSuccess,
}: {
  submitLabel?: string;
  onSuccess?: () => void;
}) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [error, setError] = useState<string | null>(null);

  const changePassword = useMutation({
    mutationFn: () => api.post("/api/v1/auth/change-password", form),
    onSuccess: () => {
      setError(null);
      setForm({ currentPassword: "", newPassword: "" });
      onSuccess?.();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not change your password"),
  });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        changePassword.mutate();
      }}
    >
      {error && <ErrorState message={error} />}
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
        minLength={10}
        required
      />
      <Button type="submit" disabled={changePassword.isPending}>
        {changePassword.isPending ? "Updating..." : submitLabel}
      </Button>
    </form>
  );
}
