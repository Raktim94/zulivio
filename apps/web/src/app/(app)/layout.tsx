"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Menu,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Play,
  ListChecks,
  ClipboardList,
  Clock,
  ShieldCheck,
  Bot,
  LifeBuoy,
  BookOpen,
  Users,
  Workflow,
  BarChart3,
  Contact,
  UserCog,
  Database,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { useCurrentEmployee, isManagerOrAbove, isMasterOwner, isSalesHeadOrAbove } from "@/lib/use-current-employee";
import { Spinner, Dialog } from "@/components/ui";
import { Logo } from "@/components/logo";
import { MadeBy } from "@/components/made-by";
import { TopBar } from "@/components/top-bar";
import { UpdateBadge } from "@/components/update-badge";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  managerOnly?: boolean;
  salesHeadOnly?: boolean;
  masterOwnerOnly?: boolean;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "My Work",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/start-work", label: "Start Work", icon: Play },
      { href: "/tasks", label: "Tasks", icon: ListChecks },
      { href: "/assignments", label: "Assignments", icon: ClipboardList },
      { href: "/attendance", label: "Attendance", icon: Clock },
    ],
  },
  {
    label: "Quality",
    items: [{ href: "/quality", label: "Quality Audits", icon: ShieldCheck }],
  },
  {
    label: "Agent Tools",
    items: [
      { href: "/agent-assist", label: "Agent Assist", icon: Bot },
      { href: "/helpdesk", label: "Helpdesk", icon: LifeBuoy },
      { href: "/knowledge", label: "Knowledge & Tips", icon: BookOpen },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/leads", label: "Leads", icon: Users },
      { href: "/pipeline", label: "Pipeline", icon: Workflow },
      { href: "/sales-dashboard", label: "Sales Dashboard", icon: BarChart3, managerOnly: true },
      { href: "/sales-head/employees", label: "Team Directory", icon: Contact, salesHeadOnly: true },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/employees", label: "Employees", icon: UserCog, managerOnly: true },
      { href: "/data-hub", label: "Data Hub", icon: Database, managerOnly: true },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/settings", label: "Settings", icon: SettingsIcon }],
  },
];

const SIDEBAR_COLLAPSED_KEY = "zulivio-sidebar-collapsed";

function NavLinks({
  pathname,
  isManager,
  isSalesHead,
  isOwner,
  collapsed,
  onNavigate,
}: {
  pathname: string;
  isManager: boolean;
  isSalesHead: boolean;
  isOwner: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV_GROUPS.map((group, groupIndex) => {
        const items = group.items.filter(
          (item) =>
            (!item.managerOnly || isManager) &&
            (!item.salesHeadOnly || isSalesHead) &&
            (!item.masterOwnerOnly || isOwner),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.label} className={groupIndex === 0 ? "" : collapsed ? "mt-3 border-t border-white/10 pt-3" : "mt-4"}>
            {collapsed ? (
              <p className="sr-only">{group.label}</p>
            ) : (
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-white/45">
                {group.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      collapsed ? "justify-center px-0" : ""
                    } ${active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
                  >
                    {active && (
                      <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-emerald-dark" aria-hidden />
                    )}
                    <Icon size={17} strokeWidth={2} className="shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

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
  const isSalesHead = isSalesHeadOrAbove(employee.role);
  const isOwner = isMasterOwner(employee.role);
  const allItems = NAV_GROUPS.flatMap((g) => g.items);
  const pageTitle = allItems.find((item) => item.href === pathname)?.label ?? "Zulivio";

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={`hidden h-full shrink-0 flex-col bg-navy py-6 text-white transition-[width] duration-200 md:flex ${
          collapsed ? "w-[68px] px-2" : "w-60 px-4"
        }`}
      >
        <div className={`mb-6 flex items-center ${collapsed ? "flex-col gap-3" : "justify-between px-2"}`}>
          <Logo size="sm" />
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <NavLinks
            pathname={pathname}
            isManager={isManager}
            isSalesHead={isSalesHead}
            isOwner={isOwner}
            collapsed={collapsed}
          />
        </div>

        <div className={`shrink-0 border-t border-white/10 pt-4 ${collapsed ? "flex flex-col items-center gap-3" : ""}`}>
          <UpdateBadge collapsed={collapsed} onDark />
          {!collapsed && <MadeBy onDark className="mt-3" />}
        </div>
      </aside>

      <Dialog open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} title="Menu" className="md:hidden">
        <div className="-m-5 flex min-h-[70vh] flex-col bg-navy px-4 py-6 text-white">
          <NavLinks
            pathname={pathname}
            isManager={isManager}
            isSalesHead={isSalesHead}
            isOwner={isOwner}
            onNavigate={() => setMobileNavOpen(false)}
          />
          <div className="border-t border-white/10 pt-4">
            <UpdateBadge onDark />
            <MadeBy onDark className="mt-3" />
          </div>
        </div>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-canvas">
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
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
