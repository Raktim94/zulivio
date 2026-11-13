# Mobile data: what is collected, why, where it goes, how long it stays

Applies to the Zulivio Android app and the mobile endpoints of your Zulivio server.

## Data flow

```
Android app  ──HTTPS──►  YOUR organization's Zulivio server  ──►  YOUR Postgres database
```

There is no other recipient: no NodeDR service, analytics, crash reporter, advertising network or push provider. The app can only talk to the server address the user typed.

## What is collected

| Data | Purpose | Where it lives | Notes |
|---|---|---|---|
| Work email + password (sign-in) | authenticate | password is sent once over HTTPS and never stored on the phone | the server stores only an Argon2id hash, as for the web app |
| Session tokens | stay signed in | phone: Keystore-encrypted. Server: SHA-256 hashes only | access 15 min, refresh 30 days, rotated; revoked on sign-out, password change, device disable |
| Installation id + device model + app version | let an administrator recognise and remove the phone | server `mobile_devices` | the id is random, **not** a hardware identifier |
| Leads, notes, follow-ups, call results the user enters | the CRM | server | same visibility rules as the web app |
| Calls started from the app / logged by hand | activity feed, follow-up | server | "started" carries no outcome or duration; durations are user-entered |
| Selected phone contacts | import into the CRM | server `mobile_contacts`, visible only to the importing employee (and as ordinary leads once imported) | name + numbers always; company/email only if the user switched them on; the device's own contact id is **not stored** (salted hash only) |
| Queued offline actions | deliver them later | phone, encrypted | removed once delivered or on sign-out |

## What is **not** collected

Call log, call recordings or audio, SMS, location, photos, contacts the user did not choose, advertising ids, or any telemetry.

## Permissions

| Permission | When | Why |
|---|---|---|
| `INTERNET` | always | talk to your server |
| `READ_CONTACTS` | only when the user starts a contact import, after an explanation | choose contacts to share |
| `POST_NOTIFICATIONS` (Android 13+) | only when the user turns on reminders | follow-up reminders |
| *(none)* | — | calls use the system dialer; **no** call-log, phone-state or call permission is declared |

## Retention and deletion

* **On the phone:** sign-out removes tokens and the outbox; *Privacy → Sign out and clear data* wipes everything; uninstalling removes it all. Nothing is included in cloud backup or device transfer.
* **Uploaded contacts:** the user can delete them from the app at any time (single or all); an administrator can set `contactRetentionDays` so unrefreshed contacts are purged nightly; removing the device deletes its contacts. Leads already created from contacts remain ordinary CRM records governed by the organization's own lead policy.
* **Call metadata:** an administrator can set `callRetentionDays`; a nightly job deletes older call records; admins can delete a device's calls or remove the device.
* **Audit:** imports, deletions, logins, device changes and integration changes are recorded in the audit log without contact details.

## Roles and visibility

Contacts a user uploads are private to that user. A duplicate check never reveals leads outside the user's scope: it reports "already in the CRM" without a name or id. Call and lead visibility follows the reporting line exactly as in the web app (employee: own; manager: direct reports; sales head: subtree; company admin / master owner: everyone).

## Legal note

Where call metadata or contacts are personal data under your jurisdiction's law, **your organization** is the controller and Zulivio is software you run. Tell staff what the app collects (this page can be shared), and get any consent your law requires before importing *third parties'* contact details. Recording call audio is not supported and would need its own legal review.
