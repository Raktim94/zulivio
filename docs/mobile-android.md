# Zulivio for Android

A native Kotlin / Jetpack Compose app for telecallers and employees. It connects to **your** Zulivio server (the one your organization hosts) — there is no NodeDR cloud service in the path, no analytics, no advertising SDK and no third-party push provider.

Source: [`apps/mobile-android`](../apps/mobile-android). Minimum Android 8.0 (API 26), targets API 35.

## What it does

| Tab / screen | Details |
|---|---|
| **My Day** | the next action first (an overdue follow-up or the next lead to call, with a one-tap call), today's numbers, shift status, hot leads, leads to contact |
| **Leads** | search, filter by stage / priority, sort by follow-up / score / recent contact; lead detail with call, SMS, WhatsApp, email, notes, call result, stage chips (no drag needed), follow-up, score explanation and timeline |
| **Follow-ups** | overdue / due now / today / tomorrow / upcoming, with call, done and reschedule |
| **Calls** | your call activity with a **source label** on every item; log a call or a missed call by hand |
| **More** | Contacts import, Tasks, Attendance, Sync status, Permission center, Privacy, Accounts & servers |

Permissions follow the web app: the phone uses the same roles and ownership rules, so an employee sees their own leads and a manager sees their team's.

## Connecting

1. Enter your server's address (HTTPS required) → *Check connection* confirms it is a Zulivio server and compatible.
2. Sign in with your normal work email and password. The phone is **enrolled as a device** that an administrator can see and remove under *Settings → Mobile Devices*.
3. Several accounts/servers can be saved and switched under *More → Accounts & servers*.

Plain `http://` is refused. It can be enabled only in a **debug build**, behind an explicit checkbox, with a persistent warning banner (see *Build & install*). Release builds forbid cleartext traffic at the operating-system level.

## Calls — what Android allows, and what Zulivio does instead

Android restricts reading the call log and phone state to default phone apps, and Google Play enforces it. Zulivio **does not** request `READ_CALL_LOG`, `READ_PHONE_STATE`, `CALL_PHONE` or `PROCESS_OUTGOING_CALLS`, and does not use accessibility services, notification scraping, hidden APIs or root. It therefore **cannot and does not claim to detect every call**. What it does:

1. **Call from the app.** *Call* opens the normal dialer with the number filled in (`ACTION_DIAL`), so no permission is needed and **you** place the call. Zulivio records only that a call was *started* — labelled **Started in app · result unknown**. It does not know whether it connected or how long it lasted, and never says it did.
2. **Result prompt.** When you return to Zulivio, it asks how the call went (connected / not connected, result, optional length, notes, callback time). What you enter is labelled **Entered by you**. Leave the length blank if you're not sure — nothing is guessed.
3. **Manual and missed-call logging** from the Calls tab, in two taps.
4. **Complete capture** (every inbound, outbound and missed call, with real durations) needs a business telephony provider or PBX that can send webhooks — see [Integrations & API → Telephony providers](integrations/api.md#telephony-providers-complete-call-capture). Those calls are labelled **Imported from provider**.

Call **audio and recordings are never collected.** Any future recording feature would need its own consent, legal review, retention and access controls.

Source labels in the timeline and Calls tab: *Entered by you* · *Started in app · result unknown* · *Imported from provider* · *Imported from device* (a static-token device such as MacroDroid).

## Contacts

Under *More → Contacts*. Nothing is requested at launch.

* `READ_CONTACTS` is requested only when you start an import, **after** an in-app explanation, and denial is handled (with a path to Android settings). Revoking later is respected: the status updates when you return.
* **You choose which contacts.** The default is a picker; *Sync everything* exists but is a separate, clearly labelled action that still shows a review before anything is sent.
* **Fields.** Name and phone numbers are always included (they're how duplicates are found). Company and email are **off** until you switch them on, and are read from the phone only for chosen contacts and only when enabled.
* **Review before upload.** Each contact is classified — *new*, *already a lead* (link or skip), *changed since last upload*, *same number as another selected contact*, *already in the CRM under another team* (skipped; no name or id revealed) — and you decide per contact.
* **Numbers** are normalised to E.164 where it can be done reliably; the original is kept; unusual formats are flagged.
* **Re-sync is incremental:** unchanged contacts are never re-uploaded; re-sync shows only what changed.
* **Revoke / delete:** *Delete uploaded contacts* removes your records from the server; deleting from the device list is per contact. Leads already created from contacts stay as ordinary CRM records.
* The phone's own contact id is **never stored**; the server keeps only a salted hash to recognise the same contact on re-sync. Skipped contacts keep only that hash.

## Offline and sync

Notes, call results, stage changes, follow-ups, manual call logs and task changes go through an **encrypted local outbox**. Each queued action has a unique id that is also its `Idempotency-Key`, so a retry after a lost response can't create a duplicate. Items are sent oldest first; they are deleted only after the server answers 2xx; network errors keep them pending (WorkManager retries, and a connection coming back triggers an immediate send); a server refusal marks the item **Failed** with the server's message — never retried blindly, never silently dropped.

You always see the state: a banner shows *N changes waiting to sync* (or *need attention*); the lead screen shows its own pending items; *More → Sync status* shows last sync, pending, failed, per-item error text, **Retry**, **Discard** and **Sync now**.

Not queued, on purpose: attendance (it must use the server's clock) and contact imports (an explicit, interactive action — safe to re-run, as the server is idempotent).

Lead lists are held in memory only. When offline you see what was loaded earlier with an "offline" notice; there is no on-disk copy of your leads.

## Security

* **Tokens** are stored encrypted with an AES-256-GCM key held in the Android **Keystore**; they never touch plain preferences. No shared admin credential or permanent API secret is embedded in the app.
* **Short-lived access** (15 min) plus a **rotating single-use refresh token** (30 days). Replaying a refresh token revokes the whole session. Revocation is checked on every request.
* **Immediate lock-out:** disabling the device, deactivating the employee, or changing/resetting their password ends the phone's access on its next request. Signing out revokes the session on the server first.
* **Least privilege:** a phone session reaches an allow-list of routes; administration is refused even for an administrator's phone.
* The app refuses to follow HTTP redirects (a redirect can't carry your token to another host), refuses plain HTTP, is excluded from cloud backup and device transfer, and holds no analytics or crash-reporting SDKs.
* *Sign out* removes tokens and queued data from the phone and (optionally) your uploaded contacts from the server. *Privacy → Sign out and clear data* wipes everything.

## Notifications

Follow-up reminders are **local**: every ~15 minutes, when online, the phone asks **your server** what is due and shows a notification. No push provider (FCM or otherwise) is involved and nothing leaves your server. Android 13+ asks for notification permission only when you switch reminders on. Delivery is best-effort and can lag by up to ~15 minutes; a self-hosted push channel (for example UnifiedPush) can be added later without changing the privacy model.

## Play Store and device limitations

* A Play listing for an app that declared call-log permissions would need to be a default phone/SMS app and pass the permissions-declaration review. Zulivio avoids the whole category by design; the options above are what is supported.
* The call-started record needs the system dialer; calls placed another way, and calls made or received outside the app, are only captured through a provider or by logging them manually.
* Some manufacturers restrict background work aggressively; if reminders or background sync stall, exempt Zulivio from battery optimisation.
* Release builds need a signing key you control (see below). Self-hosters distributing the APK directly must allow "install unknown apps" for their installer.

## Build & install

Requirements: JDK 17+ (21 recommended), the Android SDK (platform 35, build-tools 35). Network access for the first Gradle sync.

```bash
cd apps/mobile-android
export ANDROID_HOME=$HOME/Android/Sdk            # or set sdk.dir in local.properties
./gradlew :app:testDebugUnitTest                  # 23 JVM unit tests
./gradlew :app:assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**Local development server.** From an emulator the host machine is `10.0.2.2`: start the backend (`pnpm --filter backend dev`, port 4100) and in the debug app enter `http://10.0.2.2:4100`, tick *Allow insecure local connection*, then sign in. The warning banner stays visible.

**Release build.** `./gradlew :app:assembleRelease` produces a minified, **HTTPS-only** APK that you must sign with your own key (do not commit it):

```bash
apksigner sign --ks my-release.jks --out zulivio.apk app/build/outputs/apk/release/app-release-unsigned.apk
```

## Server-side setup

Nothing to configure for the app beyond upgrading the server (the migrations add the mobile auth, contacts and idempotency tables). Optional environment:

| Variable | Purpose |
|---|---|
| `DEFAULT_PHONE_COUNTRY_CODE` | country code used to normalise national numbers (default `91`) |
| `PUBLIC_API_URL` | if set, the web app shows absolute event URLs for telephony providers |
| `WEBHOOKS_ALLOW_HTTP`, `WEBHOOKS_ALLOW_PRIVATE_NETWORKS` | let webhooks target plain-HTTP / LAN receivers (off by default) |

Retention for call history and imported contacts is set by an admin under *Settings → Mobile Devices* (`PATCH /api/v1/mobile/settings` with `callRetentionDays`, `contactRetentionDays`); a nightly job removes what has expired.
