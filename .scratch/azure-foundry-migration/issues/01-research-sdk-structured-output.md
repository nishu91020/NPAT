# Which SDK and how to guarantee structured JSON

Type: research
Status: resolved

## Question

Which Node.js/TypeScript SDK should call a model deployed on Microsoft Foundry, and how do we get
guaranteed schema-conforming JSON out of it? The app depends on parsing structured output
reliably — both call sites throw to a fallback when parsing fails. Also: authentication options,
the resource/project/deployment relationship, free tier, regional or quota gates, and how local
development works without an emulator.

## Answer

Full report: [research/01-sdk-and-structured-output.md](../research/01-sdk-and-structured-output.md)

**SDK.** Use the `openai` npm package plus `@azure/identity`. Point `baseURL` at
`https://<resource-name>.openai.azure.com/openai/v1/`. Do **not** use `@azure/openai` — Microsoft
now describes it as a companion to the official client and directs users to migrate.
`@azure/ai-projects` is for Foundry-native features (agents, evaluations) and is indirection we
don't need. `@azure-rest/ai-inference` targets a different endpoint surface.

The new `/openai/v1/` route is stable and takes **no `api-version` query parameter** — a breaking
change from the older deployment-scoped path.

**Structured output.** `response_format: { type: "json_schema", json_schema: { strict: true, ... } }`
is fully supported. Critically, **only on Azure OpenAI models** (GPT-4o onward, GPT-4.1 family,
GPT-5 family, o-series). Open-weight catalog models — Phi, Llama, Mistral, DeepSeek — are reached
through a different endpoint surface and do **not** offer the same strict guarantee. This rules
them out for the Judge.

Strict-mode constraints, all of which our schemas must satisfy:
- `additionalProperties: false` on the root **and every nested object**.
- Every property must appear in `required`. Optional fields are expressed as `["string", "null"]`.
- No `minLength`/`maxLength`/`pattern`/`format`; no numeric bounds; no array-size keywords.
- Max 100 properties, 5 levels of nesting. String enums are supported.

Our current schemas are compatible in shape — everything is already `required`, nesting is 2 deep —
but need `additionalProperties: false` added throughout. Note that the "max 25 characters" style
limits in the bonus-challenge schema are **prompt instructions, not schema constraints**, and must
stay in the prompt because strict mode cannot express them.

**Auth.** Two options. API key (`AZURE_OPENAI_API_KEY`) is simplest. Microsoft recommends Entra ID
via `DefaultAzureCredential` + `getBearerTokenProvider`, which needs no stored secret and picks up
`az login` locally or a managed identity in Azure. **Gotcha:** the token scope for the v1 endpoint
is `https://ai.azure.com/.default`, not the older `https://cognitiveservices.azure.com/.default` —
a likely cause of 401s. Requires the *Cognitive Services OpenAI User* role (or *Foundry User*).

**Deployment model.** Subscription → resource group → Foundry resource (gives the endpoint) →
deployment. The **deployment name is what you pass as `model`**, not the underlying model name.
Global Standard is the recommended default. A "project" is only needed for Foundry-native features.

**Free tier / gates.** $200 credit for 30 days on a free account; no confirmed permanent free tier
for this service. New subscriptions land at quota Tier 1, which is ample for `gpt-4o-mini` /
`gpt-4.1-mini` with no approval. Newest top-end models (gpt-5.5/5.6) may need a quota request.

**Local dev.** There is **no local emulator** — you always call the real endpoint. Use a separate
cheap dev deployment, authenticate with `az login`, and keep unit tests on fakes at the port (which
this codebase already does) so no test touches the cloud.

**Flagged uncertainty.** The Azure pricing page renders values via JavaScript and returned `$-` for
every model, so the researcher could not verify prices from the official page. Numbers in
[Which model, at what cost, with what failure modes](02-research-model-cost-reliability.md) come
from secondary sources and should be confirmed in the Azure pricing calculator before being quoted
in the spec.

Also note: **"Azure AI Foundry" is now branded "Microsoft Foundry"** as of mid-2026, and docs have
moved to `learn.microsoft.com/en-us/azure/foundry/`.
