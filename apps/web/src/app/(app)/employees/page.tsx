"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { EmployeeSummary, EmploymentStatus, Role } from "@zulivio/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorState, Input, Select, Spinner } from "@/components/ui";
import { isManagerOrAbove } from "@/lib/use-current-employee";
import { useRequireRole } from "@/lib/use-require-role";

const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "SALES_HEAD", "COMPANY_ADMIN"];
const EMPLOYMENT_STATUSES: EmploymentStatus[] = ["ACTIVE", "SUSPENDED", "ON_LEAVE"];

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const { employee: currentEmployee, isLoading: authLoading, authorized } = useRequireRole(isManagerOrAbove);
  const { data, isLoading, error } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
    enabled: authorized,
  });

  const [form, setForm] = useState({ fullName: "", email: "", role: "EMPLOYEE" as Role, department: "" });
  const [credentials, setCredentials] = useState<{ employeeNumber: string; temporaryPassword: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [resetPasswordFor, setResetPasswordFor] = useState<{ name: string; temporaryPassword: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["employees"] });
  }

  const createEmployee = useMutation({
    mutationFn: () => api.post<{ employeeNumber: string; temporaryPassword: string }>("/api/v1/employees", form),
    onSuccess: (result) => {
      setCredentials(result);
      setForm({ fullName: "", email: "", role: "EMPLOYEE", department: "" });
      invalidate();
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not create employee"),
  });

  const updateEmployee = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<EmployeeSummary, "role" | "department"> & { employmentStatus: EmploymentStatus }>;
    }) => api.patch(`/api/v1/employees/${id}`, patch),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Could not update employee"),
  });

  const removeEmployee = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/employees/${id}`),
    onSuccess: invalidate,
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Could not remove employee"),
  });

  const purgeEmployee = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/employees/${id}/permanent`),
    onSuccess: invalidate,
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Could not permanently delete employee"),
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => api.post<{ temporaryPassword: string }>(`/api/v1/employees/${id}/reset-password`),
    onSuccess: (result, id) => {
      const emp = data?.find((e) => e.id === id);
      setResetPasswordFor({ name: emp?.fullName ?? "Employee", temporaryPassword: result.temporaryPassword });
    },
    onError: (err) => setRowError(err instanceof ApiError ? err.message : "Could not reset password"),
  });

  if (authLoading) return <Spinner />;
  if (!authorized) return null; // redirecting

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Employees</h1>
        <p className="text-sm text-muted">
          Add, remove, edit roles, and reset passwords for anyone below your rank — a Master Owner has full
          control over the organization.
        </p>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Add employee</h2>
        {formError && <div className="mb-3"><ErrorState message={formError} /></div>}
        {credentials && (
          <div className="mb-4 rounded-lg border border-emerald/30 bg-emerald/5 p-3 text-sm">
            <p className="font-medium text-emerald-dark">Account created — share these once, they won&apos;t be shown again:</p>
            <p className="mt-1">
              Employee number: <span className="font-mono">{credentials.employeeNumber}</span>
            </p>
            <p>
              Temporary password: <span className="font-mono">{credentials.temporaryPassword}</span>
            </p>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFormError(null);
            createEmployee.mutate();
          }}
          className="grid grid-cols-1 gap-3 md:grid-cols-4"
        >
          <Input
            aria-label="Full name"
            placeholder="Full name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            required
          />
          <Input
            aria-label="Email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <Select
            aria-label="Role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Department (optional)"
            placeholder="Department (optional)"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
          <div className="md:col-span-4">
            <Button type="submit" disabled={createEmployee.isPending}>
              {createEmployee.isPending ? "Creating..." : "Create employee"}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-medium text-ink">Directory</h2>
        {rowError && <div className="mb-3"><ErrorState message={rowError} /></div>}
        {resetPasswordFor && (
          <div className="mb-4 rounded-lg border border-emerald/30 bg-emerald/5 p-3 text-sm">
            <p className="font-medium text-emerald-dark">
              Password reset for {resetPasswordFor.name} — share this once, it won&apos;t be shown again. Their
              existing sessions have been signed out.
            </p>
            <p className="mt-1">
              New temporary password: <span className="font-mono">{resetPasswordFor.temporaryPassword}</span>
            </p>
          </div>
        )}
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ErrorState message="Could not load employees." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="pb-2">Number</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2">Department</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Report</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {data?.map((emp) => {
                  const isSelf = emp.id === currentEmployee?.id;
                  return editingId === emp.id ? (
                    <EditRow
                      key={emp.id}
                      employee={emp}
                      pending={updateEmployee.isPending}
                      onCancel={() => setEditingId(null)}
                      onSave={(patch) => {
                        setRowError(null);
                        updateEmployee.mutate({ id: emp.id, patch });
                      }}
                    />
                  ) : (
                    <tr key={emp.id} className="border-t border-border">
                      <td className="py-2 font-mono text-xs">{emp.employeeNumber}</td>
                      <td className="py-2">{emp.fullName}</td>
                      <td className="py-2">{emp.role.replace("_", " ")}</td>
                      <td className="py-2">{emp.department ?? "—"}</td>
                      <td className="py-2">
                        <Badge tone={emp.employmentStatus === "ACTIVE" ? "success" : "neutral"}>
                          {emp.employmentStatus}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <Link href={`/reports/${emp.id}`} className="text-emerald underline">
                          View
                        </Link>
                      </td>
                      <td className="py-2 text-right">
                        {isSelf ? (
                          <span className="text-xs text-muted">You</span>
                        ) : (
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => {
                                setRowError(null);
                                setEditingId(emp.id);
                              }}
                              className="text-xs text-emerald underline"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Reset ${emp.fullName}'s password? This signs them out immediately.`)) {
                                  setRowError(null);
                                  resetPassword.mutate(emp.id);
                                }
                              }}
                              className="text-xs text-amber underline"
                            >
                              Reset password
                            </button>
                            {emp.employmentStatus !== "SEPARATED" && (
                              <button
                                onClick={() => {
                                  if (confirm(`Remove ${emp.fullName}? This revokes their access.`)) {
                                    setRowError(null);
                                    removeEmployee.mutate(emp.id);
                                  }
                                }}
                                className="text-xs text-coral underline"
                              >
                                Remove
                              </button>
                            )}
                            {emp.employmentStatus === "SEPARATED" && (
                              <button
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Permanently delete ${emp.fullName}? This cannot be undone. Their record only ` +
                                        "deletes if they have no lead/assignment/attendance history — otherwise you'll see why not.",
                                    )
                                  ) {
                                    setRowError(null);
                                    purgeEmployee.mutate(emp.id);
                                  }
                                }}
                                className="text-xs text-coral underline"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function EditRow({
  employee,
  pending,
  onSave,
  onCancel,
}: {
  employee: EmployeeSummary;
  pending: boolean;
  onSave: (patch: { role: Role; department: string; employmentStatus: EmploymentStatus }) => void;
  onCancel: () => void;
}) {
  const [role, setRole] = useState<Role>(employee.role);
  const [department, setDepartment] = useState(employee.department ?? "");
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>(
    employee.employmentStatus === "SEPARATED" ? "ACTIVE" : employee.employmentStatus,
  );

  return (
    <tr className="border-t border-border bg-canvas">
      <td className="py-2 font-mono text-xs">{employee.employeeNumber}</td>
      <td className="py-2">{employee.fullName}</td>
      <td className="py-2">
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)} className="py-1">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace("_", " ")}
            </option>
          ))}
        </Select>
      </td>
      <td className="py-2">
        <Input value={department} onChange={(e) => setDepartment(e.target.value)} className="py-1" />
      </td>
      <td className="py-2">
        <Select
          value={employmentStatus}
          onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
          className="py-1"
        >
          {EMPLOYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </td>
      <td className="py-2 text-xs text-muted">—</td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-3">
          <button
            onClick={() => onSave({ role, department, employmentStatus })}
            disabled={pending}
            className="text-xs text-emerald underline disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <button onClick={onCancel} className="text-xs text-muted underline">
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}
