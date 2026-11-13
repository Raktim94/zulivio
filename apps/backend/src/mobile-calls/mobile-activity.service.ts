import { Injectable } from "@nestjs/common";
import { LeadActivityType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedDevice } from "./mobile-device.guard";

export type SourceLabel = "user_entered" | "app_observed" | "provider_imported" | "device_imported";

/** Maps whatever was stored to the four labels a person can reason about. */
export function labelFor(source: string | undefined | null): SourceLabel {
  switch (source) {
    case "user_entered":
    case "app_manual":
      return "user_entered";
    case "app_observed":
      return "app_observed";
    case "provider_imported":
      return "provider_imported";
    default:
      return "device_imported";
  }
}

@Injectable()
export class MobileActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The signed-in employee's own recent call activity: calls logged against
   * leads (typed in, or "call initiated" taps) and call-log records (manual
   * entries, imports). Always scoped to the employee and organization the
   * token resolves to; there is no parameter that widens it.
   */
  async mine(device: AuthenticatedDevice, before: Date | undefined, limit: number) {
    const cutoff = before ?? new Date(Date.now() + 60_000);
    const [activities, calls] = await Promise.all([
      this.prisma.leadActivity.findMany({
        where: { organizationId: device.organizationId, actorId: device.employeeId, type: LeadActivityType.CALL, createdAt: { lt: cutoff } },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { lead: { select: { id: true, fullName: true, phone: true } } },
      }),
      this.prisma.mobileCall.findMany({
        where: { organizationId: device.organizationId, employeeId: device.employeeId, startedAt: { lt: cutoff } },
        orderBy: { startedAt: "desc" },
        take: limit,
        include: { lead: { select: { id: true, fullName: true } } },
      }),
    ]);

    const items = [
      ...activities.map((a) => {
        const meta = (a.metadata ?? {}) as { source?: string; event?: string };
        const initiated = meta.event === "call_initiated";
        return {
          id: `a:${a.id}`,
          at: a.createdAt.toISOString(),
          kind: initiated ? "CALL_INITIATED" : "CALL_LOGGED",
          // "initiated" is never presented as completed: no outcome, no duration.
          outcome: a.callOutcome,
          disposition: a.callDisposition,
          durationSeconds: a.callDurationSeconds,
          note: initiated ? null : a.body,
          lead: a.lead ? { id: a.lead.id, fullName: a.lead.fullName } : null,
          phone: a.lead?.phone ?? null,
          sourceLabel: labelFor(meta.source),
        };
      }),
      ...calls.map((c) => {
        const meta = (c.metadata ?? {}) as { entry?: string };
        return {
          id: `c:${c.id}`,
          at: c.startedAt.toISOString(),
          kind: `CALL_${c.callType}`,
          outcome: null,
          disposition: null,
          durationSeconds: c.durationSeconds,
          note: meta.entry ?? null,
          lead: c.lead ? { id: c.lead.id, fullName: c.lead.fullName } : null,
          phone: c.phoneNumberNormalized,
          sourceLabel: labelFor(c.source),
        };
      }),
    ]
      .sort((x, y) => y.at.localeCompare(x.at))
      .slice(0, limit);

    return { items, nextBefore: items.length === limit ? items[items.length - 1].at : null };
  }
}
