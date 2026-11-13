/** Contract version stamped on every webhook payload and the /ext API. Bump only for breaking payload changes. */
export const API_VERSION = "2026-11-01";

/**
 * Event types that are actually emitted today. A type not listed here is never
 * delivered, so the UI/docs can't offer an event that would silently never fire.
 * Employee- and task-level events are intentionally absent (see docs/api).
 */
export const EVENT_TYPES: Record<string, string> = {
  "lead.created": "A lead was created",
  "lead.updated": "A lead's details changed",
  "lead.stage_changed": "A lead moved to another pipeline stage",
  "contact.created": "A phone contact was imported as or linked to a lead",
  "contact.updated": "An imported phone contact's details changed",
  "call.recorded": "A call was recorded (by a person, the mobile app, a provider or an API client)",
  "follow_up.created": "A follow-up was scheduled",
  "follow_up.completed": "A follow-up was completed",
  "deal.updated": "A deal moved stage or its forecast changed",
};
export const TEST_EVENT = "webhook.test";

/** Scopes for machine credentials. Least privilege: a credential gets only the ones ticked at creation. */
export const SCOPES: Record<string, string> = {
  "leads:read": "Read leads",
  "leads:write": "Create leads",
  "calls:read": "Read call events",
  "calls:write": "Record call events",
};

export interface LeadLike {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  source?: string | null;
  status: string;
  stageId?: string | null;
  ownerId?: string | null;
  priority?: string;
  score?: number;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

/** The only lead fields that leave the server in a webhook or /ext response. */
export function leadPayload(l: LeadLike) {
  return {
    id: l.id,
    fullName: l.fullName,
    email: l.email ?? null,
    phone: l.phone ?? null,
    company: l.company ?? null,
    source: l.source ?? null,
    status: l.status,
    stageId: l.stageId ?? null,
    ownerId: l.ownerId ?? null,
    priority: l.priority ?? null,
    score: l.score ?? 0,
    tags: l.tags ?? [],
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}
