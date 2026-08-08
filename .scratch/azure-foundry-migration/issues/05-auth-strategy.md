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

**Decided: Microsoft Entra ID via `DefaultAzureCredential`.** The user overrode the API-key
recommendation, and the override is right — the recommendation optimised for the smaller diff, but
the credential is the thing you least want to be carrying around later. There is now no secret in
`.env` at all.

Consequences:
- Three environment variables, not four — `AZURE_OPENAI_API_KEY` does not exist.
- `DefaultAzureCredential` resolves from `az login` locally and from a managed identity once hosted,
  so local and deployed configuration are identical.
- The signed-in identity needs the *Cognitive Services OpenAI User* (or *Foundry User*) role on the
  resource — a provisioning step ticket 04 must not skip.
- Scope is `https://ai.azure.com/.default`. The older `cognitiveservices` scope 401s against the v1
  route; a regression test pins this.

Verified against the installed SDK rather than assumed:
- The SDK's `AzureOpenAI` class is **not** used. It requires an `apiVersion` and rewrites requests
  onto the legacy `/openai/deployments/{name}/` path — the opposite of the stable v1 route this spec
  targets.
- The base `OpenAI` client accepts `apiKey` as `() => Promise<string>` and invokes it per request,
  which is exactly the refresh behaviour an expiring Entra token needs. Confirmed by intercepting
  the transport and asserting the `Authorization: Bearer` header, twice, with a rotating token.

See spec section 4.
