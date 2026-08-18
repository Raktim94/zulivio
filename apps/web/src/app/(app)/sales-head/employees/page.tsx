"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { SalesHeadDirectoryEntry } from "@zulivio/types";
import { api } from "@/lib/api";
import { ErrorState, Skeleton, Table, type TableColumn } from "@/components/ui";
import { isSalesHeadOrAbove } from "@/lib/use-current-employee";
import { useRequireRole } from "@/lib/use-require-role";

const PAGE_SIZE = 15;

function formatAmount(minor: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    minor / 100,
  );
}

export default function SalesHeadDirectoryPage() {
  const router = useRouter();
  const { isLoading: authLoading, authorized } = useRequireRole(isSalesHeadOrAbove);
  const { data, isLoading, error } = useQuery<SalesHeadDirectoryEntry[]>({
    queryKey: ["sales-head", "employees"],
    queryFn: () => api.get<SalesHeadDirectoryEntry[]>("/api/v1/sales-head/employees"),
    enabled: authorized,
  });
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<keyof SalesHeadDirectoryEntry>("fullName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  if (authLoading) return <Skeleton className="h-64" />;
  if (!authorized) return null; // redirecting
  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !data) return <ErrorState message="Could not load the team directory." />;

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  function onSort(key: string) {
    const typedKey = key as keyof SalesHeadDirectoryEntry;
    if (typedKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(typedKey);
      setSortDir("asc");
    }
  }

  const columns: TableColumn<SalesHeadDirectoryEntry>[] = [
    { key: "fullName", header: "Name", sortable: true, render: (e) => `${e.fullName} (${e.employeeNumber})` },
    { key: "role", header: "Role", sortable: true, render: (e) => e.role.replace(/_/g, " ") },
    { key: "openAssignments", header: "Open work", sortable: true, render: (e) => e.openAssignments },
    {
      key: "overdueAssignments",
      header: "Overdue",
      sortable: true,
      render: (e) => (e.overdueAssignments > 0 ? <span className="text-coral">{e.overdueAssignments}</span> : 0),
    },
    { key: "openLeads", header: "Open leads", sortable: true, render: (e) => e.openLeads },
    {
      key: "openPipelineValueMinor",
      header: "Pipeline value",
      sortable: true,
      render: (e) => formatAmount(e.openPipelineValueMinor),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Team Directory</h1>
        <p className="text-sm text-muted">Everyone in your reporting subtree, with their current workload.</p>
      </div>
      <Table
        columns={columns}
        rows={sorted}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
        onRowClick={(row) => router.push(`/sales-head/employees/${row.id}`)}
      />
    </div>
  );
}
