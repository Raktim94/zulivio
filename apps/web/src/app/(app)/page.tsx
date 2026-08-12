"use client";

import { useCurrentEmployee, isManagerOrAbove } from "@/lib/use-current-employee";
import { Dashboard } from "@/components/dashboard";
import { AttendanceWidget } from "@/components/attendance-widget";
import { AssignmentList } from "@/components/assignment-list";
import { TipsFeed, TrainingFeed } from "@/components/tips-and-training";
import { Spinner } from "@/components/ui";

export default function OverviewPage() {
  const { data: employee, isLoading } = useCurrentEmployee();

  if (isLoading || !employee) return <Spinner />;

  if (isManagerOrAbove(employee.role)) {
    return <Dashboard />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Welcome back, {employee.fullName.split(" ")[0]}</h1>
        <p className="text-sm text-muted">Here&apos;s what needs your attention today.</p>
      </div>
      <AttendanceWidget />
      <div className="grid gap-6 md:grid-cols-2">
        <TipsFeed />
        <TrainingFeed />
      </div>
      <div>
        <h2 className="mb-3 text-sm font-medium text-ink">My Work</h2>
        <AssignmentList />
      </div>
    </div>
  );
}
