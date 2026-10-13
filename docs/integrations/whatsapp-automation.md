# NodeDR WhatsApp Automation

[NodeDR WhatsApp Automation](https://github.com/Raktim94/nodedr-whatsapp-automation) is a companion app that sends consent-checked WhatsApp campaigns to Zulivio leads and runs an AI-assisted reply inbox.

It uses only Zulivio's existing REST API with a personal API key (Settings → API Keys). **No Zulivio change is required**, and Zulivio has no outbound webhooks, so the app polls.

| Zulivio endpoint | Used for |
|---|---|
| `GET /api/v1/leads/search` | Read leads (paged, 100/request) into a minimal cache |
| `GET /api/v1/pipelines?kind=LEAD` | Read lead stages for the stage mapping |
| `PATCH /api/v1/leads/:id/stage` | Write "Interested" etc. (live mode, after approval or if auto-write is enabled) |
| `POST /api/v1/leads/:id/notes` | Optional handoff summary (off by default) |
| `POST /api/v1/leads` | Optional lead for unknown numbers (off by default) |

Conventions Zulivio has no native field for are read from lead **tags**: `dest:Kashmir`, `lang:hi`, `travel:2027-05`.
WhatsApp opt-in is **not** stored in Zulivio; it lives in the app's consent ledger. Full detail: that repository's `docs/CRM_CAPABILITIES.md`.

**Recommended:** create a dedicated Zulivio employee for the integration with only the lead scope it needs, and issue the key from that account.
