# Mobile Call History API

Android phones send call **metadata** (number, type, time, duration, SIM) to Zulivio. No audio, SMS or contacts are collected. MacroDroid is the first client; a native Android app can use the identical contract (see [Native app contract](#native-android-app-contract)).

Base path: `/api/v1/mobile`. All bodies are JSON (`Content-Type: application/json`).

## Authentication

Each phone is registered in **Settings → Mobile Devices** (COMPANY_ADMIN or above) and assigned to one employee. Registration returns a token `zlm_…` **once**; Zulivio stores only its SHA-256 hash.

```
Authorization: Bearer zlm_xxxxxxxx
```

The server resolves organization and employee from the token. `organization_id`, `employee_id` or similar fields in a body are never read. A token is rejected when it is unknown (401), the device is disabled/revoked (403), or the employee is no longer active (403). Regenerating the token invalidates the old one immediately.

## POST /calls — one call (realtime)

```json
{
  "device_id": "android-sales-01",
  "phone_number": "+919876543210",
  "contact_name": "Rahul Sharma",
  "call_type": "outgoing",
  "started_at": "2026-10-05T14:30:20+05:30",
  "ended_at": "2026-10-05T14:34:42+05:30",
  "duration_seconds": 262,
  "sim_slot": 1,
  "sim_name": "Jio",
  "android_call_id": "optional-device-call-id",
  "external_id": "optional",
  "metadata": { "source": "macrodroid" }
}
```

| Field | Rules |
|---|---|
| `device_id` | optional; if present must equal the device the token belongs to (else 403 `DEVICE_MISMATCH`) |
| `phone_number` | required; digits plus `+ ( ) . - space`, 3–15 digits. Normalized to E.164 (default country code from `DEFAULT_PHONE_COUNTRY_CODE`, default `91`); original kept |
| `call_type` | `incoming` `outgoing` `missed` `rejected` `blocked` `unknown`; also aliases (`in`, `out`, `declined`…) and Android `CallLog.Calls.TYPE` numbers (1 in, 2 out, 3 missed, 5 rejected, 6 blocked; 4/7 → unknown) |
| `started_at` | ISO 8601 **with offset** (`+05:30`/`Z`) or epoch ms/s. Between 2000-01-01 and now+1 day. On this single endpoint only, if omitted the server stamps the receipt time and sets `metadata.time_source = "server"` |
| `ended_at` | optional, not before `started_at` |
| `duration_seconds` | integer 0–86400; defaults to `ended_at − started_at`, else 0 |
| `sim_slot`, `sim_name`, `contact_name` | optional text (markup characters stripped) |
| `android_call_id`, `external_id` | optional device-side ids used for idempotency |
| `metadata` | flat object, ≤20 keys, string/number/boolean/null values, ≤2 KB |

Responses: `201 {"success":true,"status":"created","duplicate":false}` for a new call, `200 {"success":true,"status":"duplicate","duplicate":true}` for a retry of a call already stored.

## POST /calls/bulk — historical / batched sync

```json
{ "device_id": "android-sales-01", "calls": [ { "phone_number": "+919876543210", "call_type": "incoming", "started_at": "2026-10-05T14:30:20+05:30", "duration_seconds": 45 } ] }
```

Max **500 calls per request** (413 `BATCH_TOO_LARGE` above that — split into batches), body ≤ 1 MB. Always `200` with a per-batch summary:

```json
{ "success": true, "received": 100, "created": 94, "duplicates": 5, "rejected": 1, "failed": 0,
  "last_external_call_id": "…",
  "errors": [ { "index": 7, "status": "rejected", "code": "INVALID_PHONE_NUMBER", "message": "…" } ] }
```

`rejected` = failed validation (fix the record; retrying won't help). `failed` = server-side storage error (safe to retry the batch). `success` is `false` only when `failed > 0`. One bad record never fails the batch.

## POST /devices/test — verify the connection

Body `{ "device_id": "…" }` (optional). Returns `{"success":true,"message":"Connected successfully","device":{…},"employee":"…","server_time":"…"}`, updates *Last seen*, stores **no call record**, so statistics are not affected. The Settings UI shows **Connected** once a device has been seen.

## Reading (CRM session auth, RBAC-scoped)

| Endpoint | Notes |
|---|---|
| `GET /calls` | filters: `employee_id device_id lead_id phone_number call_type` (comma list) `from to min_duration max_duration source q unassigned=true page limit` (limit ≤ 100). Employee: own calls; Manager: self+reports; Sales Head: subtree; Admin/Owner: all |
| `GET /calls/:id` | adds `metadata`, `externalId`, `androidCallId`, `syncedAt` |
| `GET /calls/summary?from&to&employee_id` | per-employee incoming/outgoing/missed counts and total duration |
| `POST /calls/:id/attach {leadId}` | link call (and other unassigned calls from that number) to a lead you can access |
| `POST /calls/:id/create-lead {fullName?}` | explicit "Create contact" — calls never create leads automatically |
| `DELETE /calls/:id`, `DELETE /calls?device_id=|employee_id=|from=&to=` | admin; unfiltered delete refused |
| `GET/POST /devices`, `GET/PATCH/DELETE /devices/:id`, `POST /devices/:id/regenerate-token`, `POST /devices/:id/status {status:"ACTIVE"|"DISABLED"}`, `DELETE /devices/:id/calls`, `POST /devices/:id/import {calls}` | admin only |
| `GET/PATCH /settings` | `{callRetentionDays}` (30–3650 or null); a nightly job deletes older calls |

Cross-tenant ids always return **404**, never 403.

## Errors

```json
{ "success": false, "error": { "code": "INVALID_PHONE_NUMBER", "message": "The supplied phone number is invalid." } }
```

| HTTP | Codes |
|---|---|
| 400 | `INVALID_REQUEST` (non-object body, bad JSON) |
| 401 | `INVALID_TOKEN` |
| 403 | `DEVICE_DISABLED`, `DEVICE_MISMATCH` |
| 404 | `NOT_FOUND` |
| 413 | `BATCH_TOO_LARGE`, `PAYLOAD_TOO_LARGE` |
| 422 | `INVALID_PHONE_NUMBER` `INVALID_CALL_TYPE` `INVALID_TIMESTAMP` `INVALID_DURATION` `INVALID_METADATA` `INVALID_FIELD` `INVALID_CALLS` |
| 429 | `RATE_LIMITED` (120 single/min and 20 bulk/min per device; 30 bad-token attempts/min per IP) |
| 500 | `INTERNAL_ERROR` (no internals ever returned) |

## Retries and de-duplication

Retry any request that timed out or returned 5xx/429 — it is idempotent. Per organization the server keeps a unique key per call:

1. `external_id` or `android_call_id` (scoped to the device), else
2. a SHA-256 fingerprint of device + normalized number + call type + `started_at` (seconds) + duration.

Additionally a call from the same device, same number and type whose start time is within 5 s of a stored call is treated as the same call, so a realtime MacroDroid event and the later call-log re-read by a native app do not double-count.

## Lead matching

On insert the normalized number is matched (last 10 digits, organization-scoped) against the organization's leads. A match sets the call's lead; otherwise the call stays **Unknown / Unassigned**.

## Native Android app contract

1. Register the device in Zulivio, enter the token in the app (store it in the Android Keystore-backed storage).
2. Request `READ_CALL_LOG` only when the user enables sync, with an in-app explanation. Since Android 9 call-log access is a restricted permission (the *Phone* permission group); apps distributed via Google Play must be approved by Google for call-log use — sideloaded/MDM-distributed company apps are not subject to Play review but still need the runtime grant. Handle denial gracefully (stay on realtime-only/disabled).
3. Read `CallLog.Calls` (`NUMBER`, `TYPE`, `DATE`, `DURATION`, `CACHED_NAME`, `PHONE_ACCOUNT_ID`/`SUBSCRIPTION_ID`, `_ID`) and send `_ID` as `android_call_id`, `DATE` (epoch ms) as `started_at`, `TYPE` as `call_type`. Treat any missing column as absent — SIM info and `DURATION` for missed/rejected vary by OEM and Android version.
4. **Initial sync**: send oldest→newest in batches of ≤ 500 to `/calls/bulk`; on `429` wait and retry; on `failed > 0` retry the batch; skip `rejected` records.
5. **Incremental sync**: after each success remember the newest `_ID`/`DATE` sent (the server also returns `last_external_call_id` and keeps `lastSyncAt` on the device) and only upload newer rows. Re-sending is always safe.
6. Use WorkManager with network constraints for background sync; never poll faster than the rate limits.

## Importing old history without an app

MacroDroid cannot read the call log in bulk. For back-filling, export the log on the phone (e.g. *SMS Backup & Restore* → calls backup XML) and upload it in **Settings → Mobile Devices → Import old history…** (`.xml`, `.csv` with `phone_number,call_type,started_at,duration_seconds,contact_name`, or `.json`). The file is parsed in the browser and sent in 500-record batches through the same dedupe path; re-importing is harmless.

## Privacy and audit

Only metadata is stored. Admins can delete a call, all of a device's calls, or the device with its data, and set automatic retention. Audit events: `mobile_device.created/token_generated/token_regenerated/disabled/enabled/removed/updated`, `mobile.sync`, `mobile.sync_large` (≥200 calls), `mobile.sync_rejected` (oversized batch), `mobile.import(_large)`, `mobile_calls.deleted`, `mobile_calls.retention_changed/retention_purge`. Tokens are never logged.
