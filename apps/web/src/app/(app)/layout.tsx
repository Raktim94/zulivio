"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { useCurrentEmployee, isManagerOrAbove, isMasterOwner } from "@/lib/use-current-employee";
import { Spinner, Dialog } from "@/components/ui";
import { Logo } from "@/components/logo";
import { MadeBy } from "@/components/made-by";
import { TopBar } from "@/components/top-bar";

interface NavItem {
  href: string;
  label: string;
  managerOnly?: boolean;
  masterOwnerOnly?: boolean;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "My Work",
    items: [
      { href: "/", label: "Overview" },
      { href: "/start-work", label: "Start Work" },
      { href: "/tasks", label: "Tasks" },
      { href: "/assignments", label: "Assignments" },
      { href: "/attendance", label: "Attendance" },
    ],
  },
  {
    label: "Quality",
    items: [{ href: "/quality", label: "Quality Audits" }],
  },
  {
    label: "Agent Tools",
    items: [
      { href: "/agent-assist", label: "Agent Assist" },
      { href: "/helpdesk", label: "Helpdesk" },
      { href: "/knowledge", label: "Knowledge & Tips" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/leads", label: "Leads" },
      { href: "/pipeline", label: "Pipeline" },
      { href: "/sales-dashboard", label: "Sales Dashboard", managerOnly: true },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/employees", label: "Employees", managerOnly: true },
      { href: "/data-hub", label: "Data Hub", managerOnly: true },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/settings", label: "Settings" }],
  },
];

function NavLinks({ pathname, isManager, isOwner, onNavigate }: {
  pathname: string;
  isManager: boolean;
  isOwner: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-4">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(
          (item) => (!item.managerOnly || isManager) && (!item.masterOwnerOnly || isOwner),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/40">
              {group.label}
            </p>
            <div className="flex flex-col gap-1">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className={`rounded-lg px-3 py-2 text-sm ${
                    pathname === item.href ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: employee, isLoading, isError } = useCurrentEmployee();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
  const isOwner = isMasterOwner(employee.role);
  const allItems = NAV_GROUPS.flatMap((g) => g.items);
  const pageTitle = allItems.find((item) => item.href === pathname)?.label ?? "Zulivio";

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-navy px-4 py-6 text-white md:flex">
        <Logo size="sm" className="mb-8 px-2" />
        <NavLinks pathname={pathname} isManager={isManager} isOwner={isOwner} />
        <MadeBy onDark className="border-t border-white/10 pt-4" />
      </aside>

      <Dialog open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} title="Menu" className="md:hidden">
        <div className="-m-5 flex min-h-[70vh] flex-col bg-navy px-4 py-6 text-white">
          <NavLinks
            pathname={pathname}
            isManager={isManager}
            isOwner={isOwner}
            onNavigate={() => setMobileNavOpen(false)}
          />
          <MadeBy onDark className="border-t border-white/10 pt-4" />
        </div>
      </Dialog>

      <div className="flex min-h-screen flex-1 flex-col bg-canvas">
        <TopBar
          title={pageTitle}
          employee={employee}
          mobileMenuButton={
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="rounded-lg p-2 text-ink hover:bg-canvas md:hidden"
            >
              <Menu size={20} />
            </button>
          }
        />
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
