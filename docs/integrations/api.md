# Integrations & API

Zulivio has four kinds of credential. They are deliberately separate, so a leak of one can't be used as another:

| Credential | Acts as | Reaches | Created by |
|---|---|---|---|
| **Employee session** (browser cookie) | one employee, with their role | the whole app | signing in |
| **Personal API key** `zlv_…` (Settings → API Keys, used by MCP) | one employee, with their role | the employee API | the employee |
| **Phone session** `zla_…` (Android app) | one employee, on one enrolled device | a short allow-list of mobile routes | signing in on the phone |
| **API client** `zlk_…` (Integrations & API → API clients) | **the organization**, with explicit scopes | `/api/v1/ext/*` only | a Company Admin |

Everything on this page is managed from **Integrations & API** in the web app (Company Admin or Master Owner). The management endpoints refuse personal API keys and phone tokens: only a signed-in browser session can mint credentials or re-point webhooks.

## Versioning

`apiVersion` is `2026-11-01`. It appears on every webhook payload and in `GET /api/v1/integrations/catalog`. New optional fields and new event types may be added without a version bump; removals or renames will bump it.

## Errors

Machine endpoints (`/api/v1/ext`, the telephony receiver, `/api/v1/mobile/*`) always answer errors in one shape:

```json
{ "success": false, "error": { "code": "INSUFFICIENT_SCOPE", "message": "This credential lacks the \"leads:write\" scope." } }
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST`, `INVALID_CURSOR`, `INVALID_IDEMPOTENCY_KEY` | malformed input; unknown fields are rejected |
| 401 | `INVALID_CREDENTIAL` | missing, malformed, unknown, **expired or revoked** (all look the same) |
| 403 | `INSUFFICIENT_SCOPE` | the credential lacks the scope the route needs |
| 404 | `NOT_FOUND` | not found **or in another organization** (never a 403, so ids can't be probed) |
| 409 | `DUPLICATE_LEAD`, `IDEMPOTENCY_IN_PROGRESS` | |
| 422 | `INVALID_PHONE_NUMBER`, `INVALID_TIMESTAMP`, `IDEMPOTENCY_KEY_REUSED`, `MAPPING_FAILED` | well-formed but not acceptable |
| 429 | `RATE_LIMITED` | see rate limits |
| 5xx | `INTERNAL_ERROR` | retry later; no internal detail is ever returned |

Every response carries an `X-Request-Id` header; quote it when asking for help.

## Rate limits and payload limits

* API clients: **600 requests/minute per credential**. Over the limit → `429` with `Retry-After: 60`.
* Failed authentication: 60/minute per client address.
* JSON bodies are limited to 1 MB (webhook receiver: 256 KB).
* Limits are in-memory per server process (see SECURITY.md); a multi-instance deployment needs a shared store.

## Idempotency

Send `Idempotency-Key: <8–128 chars of A–Z a–z 0–9 _ . : ->` on any `POST` to `/api/v1/ext` (and from the Android app). The first request with a key runs and its response is stored for 48 hours; the same key with the **same body** returns that response with `Idempotent-Replayed: true` and runs nothing; the same key with a **different body** is `422 IDEMPOTENCY_KEY_REUSED`; a key whose request is still running is `409 IDEMPOTENCY_IN_PROGRESS`; a request that failed releases its key so you can retry. Keys are namespaced per credential/device.

## API clients and scopes

Create under **Integrations & API → API clients**: a name, the scopes it needs (none by default), and an expiry (default 90 days, maximum 2 years). The secret `zlk_…` is shown **once**. The list shows owner, creation time, expiry and last use. **Rotate** issues a new secret and kills the old one in the same request; **Revoke** takes effect immediately. A credential also stops working when the employee who created it leaves the company.

| Scope | Allows |
|---|---|
| `leads:read` | `GET /api/v1/ext/leads`, `GET /api/v1/ext/leads/:id` |
| `leads:write` | `POST /api/v1/ext/leads` |
| `calls:read` | `GET /api/v1/ext/calls` |
| `calls:write` | `POST /api/v1/ext/calls` |

A route with no declared scope is refused, so a forgotten annotation fails closed.

```bash
curl https://crm.example.com/api/v1/ext/leads?limit=2 \
  -H "Authorization: Bearer $ZULIVIO_KEY"
```
```json
{ "data": [ { "id": "…", "fullName": "Aarav Mehta", "phone": "9876500001", "email": null, "company": "Mehta Textiles",
              "source": "Referral", "status": "NEW", "stageId": "…", "ownerId": "…", "priority": "NORMAL", "score": 0,
              "tags": [], "createdAt": "2026-11-13T05:35:00.000Z", "updatedAt": "2026-11-13T05:35:00.000Z" } ],
  "nextCursor": "MjAyNi0xMS0xM1QwNTozNTowMC4wMDBafGFiYy4uLg" }
```

### Pagination

`limit` 1–100 (default 25). Pass `nextCursor` back as `cursor`; `null` means you have everything. Lists are ordered by `(updatedAt, id)` ascending, so the cursor never skips or repeats a row even while data changes — use `updatedSince=<ISO time>` for the first call of an incremental sync, then follow cursors.

### Create a lead

```bash
curl -X POST https://crm.example.com/api/v1/ext/leads \
  -H "Authorization: Bearer $ZULIVIO_KEY" -H "Idempotency-Key: web-form-8f31c2" -H "Content-Type: application/json" \
  -d '{ "fullName": "Neha Kapoor", "phone": "+91 98765 43210", "company": "Kapoor Studio", "source": "Website" }'
```
`201` with the lead. A phone number that already belongs to a lead in your organization is `409 DUPLICATE_LEAD`. The organization, author and owner come from the credential — a body containing `organizationId` is rejected. Each creation is written to the audit log.

### Record a call event

```json
POST /api/v1/ext/calls
{ "provider_call_id": "pbx-8841", "event_type": "completed", "direction": "inbound",
  "phone_number": "+919812345678", "duration_seconds": 42, "agent_email": "eli@example.com" }
```
`event_type` ∈ `started | answered | completed | missed`. Events are idempotent per `(credential, provider_call_id, event_type)`; a `completed`/`missed` event is added to the matching lead's timeline labelled *Imported from provider*. Durations are never invented: omit `duration_seconds` and none is shown.

## Webhooks

**Integrations & API → Webhooks → Add webhook**: a name, an `https://` URL, and the events to receive (or all). The signing secret `whsec_…` is shown once.

| Event | Sent when |
|---|---|
| `lead.created` / `lead.updated` / `lead.stage_changed` | a lead is created / edited / moved |
| `contact.created` / `contact.updated` | a phone contact is imported or changed by the Android app |
| `call.recorded` | a call is logged by a person, the app, a provider or an API client |
| `follow_up.created` / `follow_up.completed` | a follow-up is scheduled / done |
| `deal.updated` | a deal moves stage or its forecast changes |
| `webhook.test` | you press **Send test** |

Only events that are actually emitted are offered. **Employee and task events are not implemented**, so they're not listed.

### Payload

```json
{ "id": "evt_6f1c…", "type": "lead.created", "apiVersion": "2026-11-01", "createdAt": "2026-11-13T07:18:52.032Z",
  "organizationId": "…", "data": { "id": "…", "fullName": "Hooked Lead", "phone": null, "status": "NEW", "…": "…" } }
```
`id` is stable across retries and across endpoints — de-duplicate on it.

### Headers and signature

| Header | Value |
|---|---|
| `X-Zulivio-Event-Id` / `X-Zulivio-Event-Type` | the event id and type |
| `X-Zulivio-Delivery-Attempt` | 1, 2, … |
| `X-Zulivio-Timestamp` | Unix seconds |
| `X-Zulivio-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |

`v1 = HMAC_SHA256(secret, t + "." + rawBody)` over the **exact raw bytes**. Reject if `|now − t| > 5 minutes` (replay protection) and compare in constant time.

```js
// Node.js
import { createHmac, timingSafeEqual } from "node:crypto";
export function verify(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```
```python
# Python
import hmac, hashlib, time
def verify(secret: str, header: str, raw_body: bytes) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300: return False
    mac = hmac.new(secret.encode(), parts["t"].encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, parts["v1"])
```

### Delivery, retries, and safety

* A `2xx` is success. Anything else (or a timeout after 8 s) is retried after **1 min, 5 min, 30 min, 2 h, 6 h, 12 h** — 7 attempts in all — then marked *Failed*. Redirects are never followed. You can retry any failed delivery by hand from **Delivery history**.
* After 10 deliveries in a row fail permanently, the endpoint is **paused automatically** (audited). Fix it and press Resume.
* **Pause**, **Resume**, **Rotate secret** (the old secret stops verifying immediately) and **Revoke** (queued events are cancelled) are all immediate and audited.
* The history shows status, HTTP code, error text, attempt count and next attempt — never the response body.
* **SSRF protection.** Only `https://` URLs (plain `http://` only if the operator sets `WEBHOOKS_ALLOW_HTTP=true`); no credentials in the URL; hosts on private, loopback, link-local (including cloud metadata), carrier-NAT or multicast ranges are refused — checked when you register the endpoint, again when each delivery is sent, and on the address DNS actually resolves to at connect time. Self-hosters whose receiver is on their own network can opt in with `WEBHOOKS_ALLOW_PRIVATE_NETWORKS=true`.

## Telephony providers (complete call capture)

Android doesn't let an ordinary app read all calls (see [the Android guide](../mobile-android.md#what-android-allows-and-what-zulivio-does-instead)). For automatic capture of every call, connect a business phone system or PBX **that can send an HTTP webhook**.

**Integrations & API → Telephony → Add provider** gives you an event URL (`POST /api/v1/integrations/telephony/<id>/events`) and a secret `tpsec_…` (shown once, stored encrypted). Zulivio has **no vendor-specific connector**: you describe where each fact lives in your provider's JSON, as dot paths:

| Field | Default | Meaning |
|---|---|---|
| `providerCallId` | `call_id` | unique call id (required) |
| `eventType` | `event` | the provider's word for what happened (required) |
| `customerPhone` | `from` | the customer's number (required); `customerPhoneInbound`/`customerPhoneOutbound` override it by direction |
| `direction` | `direction` | `inbound`/`outbound` (and common synonyms) |
| `startedAt` `answeredAt` `endedAt` | `started_at` … | ISO times or epoch |
| `duration` | `duration` | whole seconds |
| `agentEmail` | `agent_email` | matches an employee in your organization |

**Event words** map the provider's words onto `started`, `answered`, `completed` or `missed` (defaults cover `ringing`, `answered`, `completed`, `hangup`, `missed`, `no-answer`, …).

**Authentication.** Preferably the same signature as outgoing webhooks: `X-Zulivio-Signature: t=…,v1=HMAC_SHA256(secret, t + "." + rawBody)`, rejected if older than 5 minutes. If the provider can only send a static header, choose *static secret header* and send `X-Zulivio-Token: <secret>`. Bad credentials are a plain `401` that doesn't reveal whether the provider id exists.

**Test connection** is a dry run: it shows what your mapping extracts from a sample (or from a payload you paste) and the signing recipe; it stores nothing. The provider shows **Waiting for first event** until a real event arrives — it is never shown as connected on the strength of a test. Received/rejected counts, last event and last error are on the card.

What happens to an event: it is stored once per `(provider, call id, event type)` (provider retries are harmless); the lead is matched by the **last 10 digits** of the number within your organization (the agent's own lead wins if several match); a `completed` call with a duration > 0 is recorded as *connected*, otherwise *not connected*; `started`/`answered` are kept as events but add nothing to the timeline. The organization is decided by the provider id in the URL — anything in the payload that names an organization, employee or lead is ignored.

## Mobile sync endpoints

Used by the Android app; documented for completeness. All answer in the error format above and bind every request to the organization, employee and **enrolled device** the token resolves to — nothing in a body can change them.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/mobile/server-info` | public reachability/compatibility check (reveals no organization data) |
| `POST /api/v1/mobile/auth/login` | email + password + `{installId, name, platform, appVersion}` → access (15 min) + refresh (30 days) tokens; enrolls the device |
| `POST /api/v1/mobile/auth/refresh` | rotates the pair. Refresh tokens are **single use**; replaying one revokes the whole session family (`TOKEN_REUSED`) |
| `POST /api/v1/mobile/auth/logout` | revokes this session; `{ "purgeContacts": true }` also deletes this device's uploaded contacts |
| `POST /api/v1/mobile/contacts/preview` | dry run: classifies up to 200 contacts as `NEW / UNCHANGED / CHANGED / DUPLICATE_LEAD / DUPLICATE_HIDDEN / DUPLICATE_CONTACT / DUPLICATE_IN_BATCH / NO_PHONE` |
| `POST /api/v1/mobile/contacts/import` | idempotent upsert with a decision per contact (`IMPORT`, `LINK`, `SKIP`); unchanged contacts are not re-written |
| `GET/DELETE /api/v1/mobile/contacts` | list (cursor-paged) / delete the caller's uploaded contacts |
| `GET /api/v1/mobile/activity` | the caller's own call activity, each item labelled `user_entered`, `app_observed`, `provider_imported` or `device_imported` |
| `POST /api/v1/mobile/calls`, `/calls/bulk` | call-log ingest (also used by MacroDroid-style static tokens) |
| `POST /api/v1/leads/:id/call-initiated` | records that the user *started* a call from the app — labelled `app_observed`, no outcome, no duration |

A phone session may only call an allow-list of CRM routes (My Day, leads, follow-ups, attendance, tasks, the endpoints above). Administration — API keys, backups, employee management, bulk lead actions, scoring configuration, integrations, the audit log — is refused **even for a Company Admin's or Master Owner's phone**.

`Idempotency-Key` is honoured on all phone writes, so an offline retry can't create a duplicate note, call or follow-up.

## Audit trail

Written for: credential created/rotated/revoked; webhook created/updated/paused/resumed/rotated/tested/revoked/auto-paused/delivery retried; telephony provider created/updated/rotated/tested/deleted; device enrolled, login/logout, refresh-token replay; contact imports and deletions; `ext` lead creation; **lead deletion** (single, bulk, and delete-all). View with `GET /api/v1/audit-events`.

## OpenAPI

Not provided. The Nest controllers aren't annotated accurately enough to generate a trustworthy spec, and a hand-written one would drift. This page is the contract; the e2e tests in `apps/backend/test/integrations.e2e-spec.ts` and `mobile-app.e2e-spec.ts` pin it.
