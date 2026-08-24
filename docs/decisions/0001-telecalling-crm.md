# 0001 — Telecalling / Lead Management CRM

- **Status**: Accepted, shipped
- **Date**: 2026-08-24
- **Scope**: `apps/backend/src/leads`, `apps/backend/src/calling`,
  `apps/backend/src/reports`, `apps/backend/src/pipelines`,
  `apps/web/src/app/(app)/{leads,my-day,follow-ups,reports}`,
  `packages/types`

## Context

Zulivio already shipped a first cut of Sales CRM: leads with a coarse
qualification pipeline, lead→opportunity conversion, a Kanban deal board,
assignment routing with SLAs, an audit log, and a forecast dashboard. What it
did **not** have was the telecalling loop — the thing a phone-first inside
sales team does all day:

> log in → see today's work → call the next lead → record what happened →
> qualify → move the stage → schedule the follow-up → next lead.

That loop needs call dispositions, a per-lead activity timeline, real
due-dated follow-ups, lead scoring, and a workspace that lets a telecaller do
all of it without navigating between pages.

**The dominant constraint on this work was backward compatibility.** A
separate product, Submify, pushes submissions into this instance in
production via `POST /api/v1/leads`, authenticated with a personal API key,
and relies on Zulivio's own assignment-rule engine to route the resulting
lead. Breaking that endpoint's request or response shape would break a live
integration. Everything below is therefore **additive**.

## Decision

Extend what exists. Build new only where nothing existed.

### Reused as-is (not rebuilt)

| Capability | What already existed | How the CRM work uses it |
|---|---|---|
| **Temporary password + forced change** | `Employee.mustChangePassword` (defaults `true`), set on creation, returned in the login response, cleared on change, re-armed on admin reset | Untouched. Verified by test, not assumed — see "Testing" below. |
| **RBAC roles** | `Role { MASTER_OWNER, COMPANY_ADMIN, SALES_HEAD, MANAGER, EMPLOYEE }` + `common/roles.ts` hierarchy | Admin → `COMPANY_ADMIN`/`MASTER_OWNER`, Manager → `MANAGER`/`SALES_HEAD`, Employee → `EMPLOYEE`. No parallel role system. |
| **Org-chart scoping** | `EmployeeScopeService` (self / direct reports / subtree / whole org) | Now also governs leads — see "Consequences". |
| **Assignment engine** | `assignment-rules/` with `ROUND_ROBIN`/`TERRITORY`/`CAPACITY`, SLA minutes, capacity caps | Bulk assign calls `assignNext()` once per lead. New entry point, same engine. |
| **Pipeline / stages** | `Pipeline` + `PipelineStage` with `sortOrder`, `probability`, `isWon`, `isLost` | The telecalling board is a second `Pipeline` row (`kind = LEAD`) using the *same* models. Stage config, drag-and-drop and stage reporting are one implementation. |
| **Deals** | `Opportunity` (value, expected close date, owner, status, loss reason, forecast category) + `OpportunityEvent` stage history | Unchanged. Conversion now carries a qualified `budgetMinor` across as the deal amount when the caller names no amount. |
| **Audit log** | `AuditEvent` + `audit/` | New actions written into it: `lead.stage_changed`, `lead.qualification_changed`, `lead.reassigned`. No second audit mechanism. |
| **Deactivate over delete** | `EmploymentStatus.SEPARATED` + `separatedAt` | Kept. There is deliberately **no bulk delete** for leads — they are disqualified with a reason. |
| **Design system / charts** | `components/ui.tsx` (Card, Button, Dialog, Tabs, Toast, StatCard…), Tailwind v4 `@theme` tokens, `recharts` | Every new screen uses these. No second component library, no second charting library, no new drag-and-drop dependency (the board uses the native HTML5 DnD API). |
| **Validation & errors** | `class-validator` DTOs, global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`), `AllExceptionsFilter` | Followed exactly. Validation was not loosened — an unknown field on `POST /api/v1/leads` is still a 400. |

### Newly built

| Piece | Where | Why it did not exist |
|---|---|---|
| **Call disposition tracking** | `CallOutcome` + `CallDisposition` enums, `POST /leads/:id/calls/disposition` | Nothing recorded call outcomes. The outcome/disposition pair is validated server-side so a `NOT_CONNECTED` call can't carry `MEETING_BOOKED` and corrupt connect-rate reporting. |
| **Activity timeline** | `LeadActivity` model, `LeadActivityService` | No per-lead history existed. Append-only; every entry is written in the *same transaction* as the change it describes. |
| **Real follow-ups** | `LeadFollowUp` model, `LeadFollowUpsService`, `/api/v1/follow-ups` | "Follow-up" existed only as `AssignmentStatus.FOLLOW_UP` — a flag on an unrelated model, with no due date, no lead link and no completion record. That value is left alone; this is a separate entity for a separate concern. |
| **Lead scoring** | `LeadScoreConfig` model, `LeadScoringService` | Weights live in the database, one row per org, created lazily with the brief's defaults (budget 25, decision maker 20, urgent requirement 20, clear requirement 15, short timeline 10, business fit 10; HOT ≥ 80, WARM ≥ 50). Tuning a weight must not need a redeploy. |
| **Qualification fields** | `budgetMinor`, `timelineDays`, `isDecisionMaker`, `requirement`, `requirementUrgent`, `businessType`, `existingSolution`, `purchaseIntent`, `goodBusinessFit` | Feed the score; also gate the "Qualified" stage so it means the same thing for every rep. |
| **Granular loss reasons** | `LeadLossReason` enum + `lossNotes` | `LeadStatus` only had the single coarse `DISQUALIFIED`, which can't answer "why did we lose this?". |
| **Extra lead fields** | `jobTitle`, `website`, `campaign`, `tags[]`, `priority`, `lastContactedAt`, `nextFollowUpAt`, `callCount`, `qualifiedAt` | All optional/defaulted. |
| **Calling provider seam** | `calling/` — `CallProvider` interface, `CALL_PROVIDER` DI token, `ManualCallProvider` | Real telephony is out of scope (below). What ships is the interface plus a manual `tel:` provider, so adding a dialer is one binding change and nothing in `leads/` moves. |
| **Server-side search** | `GET /api/v1/leads/search` | Deliberately a *new* endpoint. `GET /api/v1/leads` returns a bare array that existing clients index into; wrapping it in `{ items, total }` would be a breaking change for no benefit. |
| **Call Next Lead** | `GET /api/v1/leads/next` | Priority order per the brief: overdue follow-up → callback due soon → hot lead → new lead → oldest untouched. Each tier is a separate narrow query so a reviewer can read the order and check it. |
| **Dashboards** | `/leads/my-day`, `/reports/team-performance`, `/reports/crm-overview` | Telecaller, manager and admin views respectively. |
| **UI** | `/my-day`, `/leads` (Board / List / Capture tabs), `/leads/[id]`, `/follow-ups`, `/reports` | The lead workspace is one screen: header + Call/WhatsApp/Email, stage strip, qualification with a live score breakdown, timeline, and a prominent next action. |

### Key design choices worth defending

**The board does not fragment `LeadStatus`.** The nine telecalling stages
(New → Contacted → Connected → Interested → Qualified → Meeting Booked →
Proposal Sent → Negotiation → Won, plus Lost) are configurable
`PipelineStage` rows. The coarse `LeadStatus` is *derived* from the target
stage — `isLost` → `DISQUALIFIED`, first stage → `NEW`, `probability >= 50`
→ `QUALIFIED`, else `CONTACTED`. Derived from the stage's own configurable
fields rather than its name, so a renamed or newly added stage still lands
somewhere sensible. `CONVERTED` is never derived; only the existing
conversion endpoint sets it.

**A board must allow going backwards.** `PATCH /leads/:id/stage` does not run
`LEAD_ALLOWED_TRANSITIONS` — a rep who has a bad second call must be able to
drag Interested back to Contacted, which that forward-only state machine
forbids by design. The state machine still governs `PATCH /leads/:id`
unchanged, so no existing caller sees different behavior.

**`GET /api/v1/pipelines` defaults to `kind=OPPORTUNITY`.** This is
load-bearing: the web deal board reads `pipelines[0]`, so returning the lead
pipeline there would silently swap the deal board's stages. Pass `?kind=LEAD`
to get the telecalling board.

**Disposition can move the card, but never at the cost of the record.** Stage
movement implied by a disposition runs *outside* the transaction that writes
the call, because it has its own qualification gate. If that gate rejects the
implied stage, the call is still logged — the call is the thing that actually
happened.

## Consequences

**One deliberate behavior change.** Lead visibility moved from
`isManagerOrAbove` (any line manager could read and reassign every other
team's leads org-wide) to `EmployeeScopeService`, the same org-chart scoping
already applied to assignments and reports in the earlier RBAC pass.
Admins and owners keep org-wide access, so nobody who is supposed to see
everything was narrowed; unassigned leads stay visible to Manager+ so a lead
nobody owns yet is still visible to the people who route it. This is the
brief's explicit "no blanket admin permissions" requirement and closes a real
cross-team data leak.

**Migration `20260824090000_telecalling_crm` is additive only** — new enums,
new tables, and `ADD COLUMN` on `leads`/`pipelines`. No drops, no renames, no
type changes, and every new column is nullable or defaulted, so existing rows
and the running instance are unaffected.

## Testing

`apps/backend/test/telecalling-crm.e2e-spec.ts` (53 tests) plus the existing
suites — **142/142 pass**. Both real builds (`nest build`, `next build`) and
`turbo lint` are green.

The `backward compatibility of the pre-existing lead API` describe block is a
standing regression guard for the Submify integration: it asserts every
original field is still on the `POST /api/v1/leads` response, that
`GET /api/v1/leads` is still a bare array, that the original `?status=`/
`?overdue=` filters and the status state machine still behave, that
`GET /api/v1/pipelines` still returns only the opportunity board, and that
validation was not loosened. If a future change breaks any of that, it fails
before it ships.

## Out of scope this release — future updates backlog

Not built, not stubbed. Listed so the boundary is explicit.

**Telephony**
- Cloud telephony / SIP trunking, browser softphone
- Power dialer, predictive dialer, auto-dialer campaigns
- Call recording and recording storage, consent capture
- IVR, inbound call routing, queues, whisper/barge
- *(The `CallProvider` seam in `apps/backend/src/calling/` is where this
  plugs in — bind `CALL_PROVIDER` to a new class.)*

**AI**
- Call transcription, sentiment analysis, objection detection
- Call-quality coaching and automated scoring
- Conversation summaries, next-best-action suggestions
- AI/predictive lead scoring *(scoring here is a transparent, configurable
  weighted rubric, deliberately not a model)*

**Automation**
- Visual workflow builder / automation designer
- Advanced round-robin, conditional and skill-based routing
- Multi-step marketing sequences, drip campaigns, pause-on-reply
- *(A basic assignment-rules engine already exists and was reused. It should
  not be grown into a general automation platform here.)*

**Messaging**
- WhatsApp Business API automation, templates, delivery status
- Bulk WhatsApp / SMS / email campaigns
- Email tracking, sequences, inbox sync
- *(The workspace's WhatsApp and Email buttons are plain `wa.me` and
  `mailto:` links — a convenience, not an integration.)*

**Advanced analytics**
- Forecasting engine beyond the existing weighted forecast
- Revenue attribution, multi-touch attribution
- Cohort analytics, predictive conversion analytics

**Platform configurability**
- Fully customizable CRM objects and fields
- Custom dashboard builder
- Workflow scripting
- Advanced permission designer *(roles remain the five in `Role`)*
