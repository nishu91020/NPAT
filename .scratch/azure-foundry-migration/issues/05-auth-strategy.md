# Decide the authentication strategy

Type: grilling
Status: resolved
Blocked by: 01

## Question

API key, or Microsoft Entra ID via `DefaultAzureCredential`?

The key is simpler and mirrors how `GEMINI_API_KEY` works today, so it is the smaller change. Entra
ID is what Microsoft recommends for server-side apps, stores no secret, and works automatically from
`az login` locally and from a managed identity once hosted — but it needs an RBAC role assignment
and carries the scope gotcha (`https://ai.azure.com/.default`, not the older Cognitive Services
scope).

Decide:
- Which mechanism for local development, and which for deployed environments — they need not match.
- The environment variable names, and how the adapter decides it is configured at all. Today
  `createGeminiClient()` returns `null` when the key is absent and the app silently runs on the
  heuristic; the replacement needs an equivalent, well-defined "not configured" state.
- Whether a missing or invalid credential should fail loudly at startup instead of degrading
  silently — the current silent degradation is convenient locally but hides misconfiguration in
  production.

Note the hosting target is out of scope for this map, so decide in a way that does not depend on it.

## Answer

Approved as specified. API key now (mirrors the existing `GEMINI_API_KEY` shape and does not pre-commit the hosting decision); Entra ID revisited when hosting is settled, which is out of scope for this map. See spec section 4.
