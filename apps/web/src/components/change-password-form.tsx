"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button, ErrorState, PasswordInput } from "@/components/ui";

export function ChangePasswordForm({
  submitLabel = "Update password",
  onSuccess,
}: {
  submitLabel?: string;
  onSuccess?: () => void;
}) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const changePassword = useMutation({
    mutationFn: () => api.post("/api/v1/auth/change-password", form),
    onSuccess: () => {
      setError(null);
      setForm({ currentPassword: "", newPassword: "" });
      setConfirmPassword("");
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
        if (form.newPassword !== confirmPassword) {
          setError("New passwords do not match");
          return;
        }
        changePassword.mutate();
      }}
    >
      {error && <ErrorState message={error} />}
      <PasswordInput
        placeholder="Current password"
        value={form.currentPassword}
        onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
        required
      />
      <PasswordInput
        placeholder="New password"
        value={form.newPassword}
        onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
        minLength={10}
        required
      />
      <PasswordInput
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        minLength={10}
        required
      />
      <Button type="submit" disabled={changePassword.isPending}>
        {changePassword.isPending ? "Updating..." : submitLabel}
      </Button>
    </form>
  );
}
