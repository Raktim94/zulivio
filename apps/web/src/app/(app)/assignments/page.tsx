"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmployeeSummary } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { AssignmentList } from "@/components/assignment-list";
import { Button, Card, ErrorState, Input, Select } from "@/components/ui";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";

export default function AssignmentsPage() {
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const { data: employees } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
    enabled: isManagerOrAbove(employee?.role),
  });

  const [form, setForm] = useState({ title: "", description: "", ownerId: "", priority: "normal", dueAt: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const createAssignment = useMutation({
    mutationFn: () =>
      api.post("/api/v1/assignments", {
        ...form,
        ownerId: form.ownerId || undefined,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      setForm({ title: "", description: "", ownerId: "", priority: "normal", dueAt: "" });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not create assignment"),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Assignments</h1>
        <p className="text-sm text-muted">Create work and assign it to a selected employee.</p>
      </div>

      {isManagerOrAbove(employee?.role) && (
        <Card>
          <h2 className="mb-4 text-sm font-medium text-ink">New assignment</h2>
          {formError && <div className="mb-3"><ErrorState message={formError} /></div>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setFormError(null);
              createAssignment.mutate();
            }}
            className="grid grid-cols-1 gap-3 md:grid-cols-5"
          >
            <Input
              className="md:col-span-2"
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
            <Select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}>
              <option value="">Unassigned</option>
              {employees?.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.employeeNumber} — {emp.fullName}
                </option>
              ))}
            </Select>
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
            <Input
              type="date"
              value={form.dueAt}
              onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
            />
            <Input
              className="md:col-span-5"
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="md:col-span-5">
              <Button type="submit" disabled={createAssignment.isPending}>
                {createAssignment.isPending ? "Creating..." : "Create assignment"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <AssignmentList />
    </div>
  );
}
