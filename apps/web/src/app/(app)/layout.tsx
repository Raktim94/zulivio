"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { Logo } from "@/components/logo";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/employees", label: "Employees", managerOnly: true },
  { href: "/assignments", label: "Assignments" },
  { href: "/attendance", label: "Attendance" },
  { href: "/knowledge", label: "Knowledge & Tips" },
  { href: "/data-hub", label: "Data Hub", managerOnly: true },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: employee, isLoading, isError } = useCurrentEmployee();

  useEffect(() => {
    if (isError) router.replace("/login");
  }, [isError, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner />
      </div>
    );
  }

  if (!employee) return null;

  const isManager = isManagerOrAbove(employee.role);

  async function logout() {
    await api.post("/api/v1/auth/sessions/logout");
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-navy px-4 py-6 text-white md:flex">
        <Logo size="sm" className="mb-8 px-2" />
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.filter((item) => !item.managerOnly || isManager).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm ${
                pathname === item.href ? "bg-white/10 font-medium" : "text-white/70 hover:bg-white/5"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10 pt-4 text-xs text-white/60">
          <p className="font-medium text-white">{employee.fullName}</p>
          <p>{employee.role.replace("_", " ")}</p>
          <button onClick={logout} className="mt-3 text-white/70 underline hover:text-white">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 bg-canvas px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
