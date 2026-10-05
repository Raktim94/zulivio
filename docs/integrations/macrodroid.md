# MacroDroid setup (call history → Zulivio)

MacroDroid is the first client of the [Mobile Call History API](mobile-calls.md). Each call type needs its own macro because the call direction is fixed by the trigger.

> **What MacroDroid can and cannot give you.** The magic-text values MacroDroid documents for its call triggers are `{call_number}`, `{call_name}` and `{call_groups}`. We found no documented call-duration or SIM variable, so **do not invent them**. Where a value is not available the server fills in what it can: `started_at` defaults to the time Zulivio received the event (flagged `metadata.time_source: "server"`) and `duration_seconds` to 0. If your MacroDroid version offers date/time or other variables in its *magic text* picker (the `{…}` button in a text field) you can add them to the body — pick them from the picker rather than typing names from memory. MacroDroid also cannot read old call history; use the Import feature or a native app for that (see [mobile-calls.md](mobile-calls.md#importing-old-history-without-an-app)).

## 1. Register the phone

Zulivio → **Settings → Mobile Devices → Add device**. Name it, give it an ID (e.g. `android-sales-01`), assign the employee, and copy the token shown (only once).

## 2. Android permissions

On the phone, grant MacroDroid when prompted: **Phone** (call state/number), **Contacts** (so `{call_name}` resolves), and Notifications. Then in Android settings exempt MacroDroid from battery optimisation (*Settings → Apps → MacroDroid → Battery → Unrestricted*; on Xiaomi/Oppo/Vivo/Samsung also enable *Autostart* / *Allow background activity*), otherwise macros silently stop after the phone idles.

## 3. Create a macro per call type

| Macro | Trigger (Add Trigger → Call/SMS) | `call_type` |
|---|---|---|
| Incoming | *Call Ended* (filter: incoming/any) or *Call Incoming* | `incoming` |
| Outgoing | *Call Outgoing* / *Call Ended* | `outgoing` |
| Missed | *Call Missed* → Any Number | `missed` |

Use *Call Ended* for completed calls if you want the event sent after hang-up. Make sure the contact filter is "Any Number".

## 4. Action: HTTP Request

*Add Action → Connectivity → HTTP Request (Web Hook)*:

- **URL:** `https://YOUR-ZULIVIO-DOMAIN/api/v1/mobile/calls`
- **Method:** POST
- **Content Body (JSON)** — tap `{…}` to insert the call variables:

```json
{
  "device_id": "android-sales-01",
  "phone_number": "{call_number}",
  "contact_name": "{call_name}",
  "call_type": "missed",
  "metadata": { "source": "macrodroid" }
}
```

- **Request headers:** `Authorization: Bearer YOUR_DEVICE_TOKEN` and `Content-Type: application/json`.
- Tick *Block next actions until complete* off; enable *Follow redirects*. A `201`/`200` response means stored (a retry returns `200 duplicate`).

Private/hidden numbers arrive without a usable number and are rejected with `422 INVALID_PHONE_NUMBER` — expected.

## 5. Test

Run the macro manually, or from any computer:

```bash
curl -X POST https://YOUR-ZULIVIO-DOMAIN/api/v1/mobile/devices/test \
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"device_id":"android-sales-01"}'
# → {"success":true,"message":"Connected successfully", ...}

curl -X POST https://YOUR-ZULIVIO-DOMAIN/api/v1/mobile/calls \
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"phone_number":"+919876543210","call_type":"outgoing","started_at":"2026-10-05T14:30:20+05:30","duration_seconds":262}'
```

Zulivio shows the device as **Connected** and the call under **Calls**. The test endpoint stores no call.

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| 401 `INVALID_TOKEN` | wrong/old token or missing `Bearer ` prefix — regenerate and paste again |
| 403 `DEVICE_DISABLED` | device revoked in Zulivio, or its employee is inactive |
| 403 `DEVICE_MISMATCH` | `device_id` in the body differs from the device the token was issued to |
| 422 `INVALID_CALL_TYPE` / `INVALID_TIMESTAMP` | typo in the body; timestamps need an offset (`+05:30`) |
| 429 | more than 120 events/min — shouldn't happen from real calls |
| Nothing arrives | battery optimisation killed MacroDroid; check macro is enabled and MacroDroid's own log (*Log* tab) shows the trigger firing |
| Names missing | Contacts permission not granted, or number not saved |
| MacroDroid shows HTTP error with no network | the request is not queued by MacroDroid — add a *Constraint: Internet connected*, and re-send missed ones via the Import feature |
