"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { EmployeeSummary, Role } from "@nodedr-crm/types";
import { api, ApiError } from "@/lib/api";
import { Badge, Button, Card, ErrorState, Input, Select, Spinner } from "@/components/ui";

const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "SALES_HEAD", "COMPANY_ADMIN"];

export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<EmployeeSummary[]>({
    queryKey: ["employees"],
    queryFn: () => api.get<EmployeeSummary[]>("/api/v1/employees"),
  });

  const [form, setForm] = useState({ fullName: "", email: "", role: "EMPLOYEE" as Role, department: "" });
  const [credentials, setCredentials] = useState<{ employeeNumber: string; temporaryPassword: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createEmployee = useMutation({
    mutationFn: () => api.post<{ employeeNumber: string; temporaryPassword: string }>("/api/v1/employees", form),
    onSuccess: (result) => {
      setCredentials(result);
      setForm({ fullName: "", email: "", role: "EMPLOYEE", department: "" });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : "Could not create employee"),
  });

  const removeEmployee = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/employees/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Employees</h1>
        <p className="text-sm text-muted">Add, remove, and manage roles for your team.</p>
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
            placeholder="Full name"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            required
          />
          <Input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Input
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
                {data?.map((emp) => (
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
                      {emp.employmentStatus === "ACTIVE" && (
                        <button
                          onClick={() => {
                            if (confirm(`Remove ${emp.fullName}? This revokes their access.`)) {
                              removeEmployee.mutate(emp.id);
                            }
                          }}
                          className="text-xs text-coral underline"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
