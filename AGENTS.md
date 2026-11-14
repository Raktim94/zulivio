# AGENTS.md — Zulivio

## Integrating with Zulivio
Read [`prompts/AI_INTEGRATION_PROMPT.md`](prompts/AI_INTEGRATION_PROMPT.md). Essentials: the organization API (`/api/v1/ext`, `zlk_…` scoped clients) covers **leads and calls only**; employees, attendance and tasks are not in the public API. MCP uses personal `zlv_…` keys that act as one employee. Call server-side, send `Idempotency-Key` on POST, verify webhook signatures. No OpenAPI or SDK. Contract: [`docs/integrations/api.md`](docs/integrations/api.md). Self-hosted: ask for URL and key, never invent or commit them.

## Working on this repo
See `README.md`, `SECURITY.md`. No Co-Authored-By trailers.
