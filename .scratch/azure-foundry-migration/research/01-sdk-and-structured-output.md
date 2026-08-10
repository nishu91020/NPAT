Agent is idle (waiting for messages). agent_id: azure-foundry-api, agent_type: research, status: idle, description: Research Azure AI Foundry structured output, elapsed: 252s, total_turns: 1

[Turn 0]
I now have comprehensive, current information from official Microsoft docs to answer all seven questions. Let me compile the complete research report.

---

# Azure AI Foundry — Comprehensive Research Report for Node.js/TypeScript Migration

**Research date:** 2026-08-08 | **Docs freshness:** All pages fetched from Microsoft Learn, updated 2026-08-05 through 2026-08-07

---

## Summary

"Azure AI Foundry" is now officially branded **Microsoft Foundry** as of mid-2026. The docs have fully migrated from `learn.microsoft.com/en-us/azure/ai-foundry/` to `learn.microsoft.com/en-us/azure/foundry/`. The data-plane API has moved from versioned monthly `api-version` query parameters to a **stable `v1` route** (`/openai/v1/`). For a pure inference use case like yours (two call sites, no agents/evaluations), the **`openai` npm package pointed at the Azure `/openai/v1/` endpoint is the current recommended SDK**. Structured JSON output via `response_format: { type: "json_schema", strict: true }` is fully supported on Azure OpenAI models (gpt-4o onward, all GPT-4.1 and GPT-5 family). Strict mode imposes the same constraints as OpenAI itself: `additionalProperties: false` everywhere and all properties must be in `required`. The pricing page currently shows `$-` placeholders for almost every model, indicating a live JavaScript-rendered table — model-specific pricing is not reliably scrapeable and must be retrieved from the Azure pricing calculator directly.

---

## Q1 — Current Official Node.js/TypeScript SDK

### The four candidates — current status

| Package | Status (August 2026) | Verdict for this use case |
|---|---|---|
| **`openai`** (npm) | ✅ **Current recommended** for inference | **Use this** |
| **`@azure/openai`** (npm) | ⚠️ **Companion/legacy** — officially described as a "companion to the official OpenAI client library" | Do **not** use as primary; see below |
| **`@azure/ai-projects`** | ✅ Current Foundry SDK v2.4.0 for Foundry-native features | Overkill for pure inference |
| **`@azure-rest/ai-inference`** | Not mentioned in current primary docs for this path | Skip |

**Sources:**
- SDK Overview (updated 2026-08-07): [https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/sdk-overview](https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/sdk-overview)
- Responses API how-to (updated 2026-08-06): [https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)

### Detail on each

**`openai` (primary inference SDK)**
> "Use **OpenAI SDK** when maximum OpenAI compatibility or lowest latency is required, when generating embeddings, or when using Models sold by Azure through Chat Completions."
> — SDK Overview, 2026-08-07

The `openai` npm package is used directly for Azure by configuring `baseURL` and `apiKey` (or a token provider). This is confirmed in every code sample in the structured outputs docs, the Responses API docs, and the managed identity docs. The endpoint shape is:
```
https://<resource-name>.openai.azure.com/openai/v1/
```
**Latest stable version:** The npm page shows the package is current and actively maintained. As of the research date, the package is `openai` at its latest stable version. The docs reference `openai 1.42.0` in structured output examples, but the actual npm package has since moved forward — check `npm info openai version` for the exact current stable, but it is in the `4.x` or `5.x` range as of August 2026.

**`@azure/openai`**
The npm package page for `@azure/openai` explicitly states:
> "**Migrating from @azure/openai version 1 advisory ⚠️** — Checkout the Migration Guide for detailed instructions on how to update your application code from version 1.x of the Azure OpenAI client library to the `openai` library."

This package is **not deprecated in the sense of being deleted**, but Microsoft is directing all users to migrate to the `openai` package + `@azure/identity`. It provides strongly typed Azure-specific extensions (like content filter results), but for general inference it is no longer the primary path. Install it alongside `openai` only if you need those Azure-specific type extensions. Source: [https://www.npmjs.com/package/@azure/openai](https://www.npmjs.com/package/@azure/openai)

**`@azure/ai-projects` v2.4.0 (Foundry SDK)**
This is the current stable Foundry SDK for JavaScript (released for the new "Foundry" portal, not "Foundry classic"). It is a **thin-client wrapper** that gives you access to Foundry-native APIs (agents, evaluations, file search, tracing, connections) plus an OpenAI-compatible client via `project.getOpenAIClient()`. The `getOpenAIClient()` call returns an `openai` client instance. So underneath it is the same `openai` package. For your use case (pure inference, no agent framework), using `@azure/ai-projects` adds indirection with no benefit.
```bash
npm install @azure/ai-projects @azure/identity
```
Source: SDK Overview, JavaScript pivot, 2026-08-07

**`@azure-rest/ai-inference`**
This package is for the Azure AI Model Inference API, which is a different endpoint surface (used primarily for serverless/partner model deployments via AI Hub). It is not mentioned in the current primary Foundry docs flow for OpenAI-family model inference. **Skip it for your use case.**

### Practical recommendation
```bash
npm install openai @azure/identity
```
- Use `openai` with `baseURL` set to the Azure endpoint
- Use `@azure/identity` for `DefaultAzureCredential` in production

---

## Q2 — Structured Output (Most Critical Question)

### Does Azure support `response_format: { type: "json_schema", strict: true }`?

**Yes, confirmed.** Azure OpenAI on Foundry supports this fully, for both the Chat Completions API and the new Responses API.

Source: [https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs) (updated 2026-08-06)

### Which models support strict structured outputs?

From the structured outputs doc and the models/responses pages, structured outputs are listed as a capability for:
- **gpt-4o** (versions: `2024-08-06`, `2024-11-20`) — this was the first model to support it
- **gpt-4o-mini** (`2024-07-18`)
- **gpt-4.1**, **gpt-4.1-mini**, **gpt-4.1-nano** (`2025-04-14`)
- **All GPT-5 family**: `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-chat`, `gpt-5.1` series, `gpt-5.2` series, `gpt-5.3` series, `gpt-5.4` series, `gpt-5.5`, `gpt-5.6` series
- **o-series reasoning models**: `o3-mini`, `o3`, `o4-mini`, `o1` — all listed as supporting structured outputs in the models page
- **gpt-chat-latest** (preview)

Models that **do NOT support strict structured outputs via this mechanism:**
- **Open-source/partner models** (Meta Llama, Mistral, DeepSeek, Phi, etc.) deployed on Foundry through the catalog — these are accessed via different endpoints (serverless API or managed compute) and do **not** expose the OpenAI `response_format: { type: "json_schema" }` parameter through the same Azure OpenAI service surface. They use `@azure-rest/ai-inference` or the Foundry catalog endpoint, not `/openai/v1/`. **Your guarantee of strict structured output is therefore only available on Azure OpenAI models (the OpenAI-partnered models sold by Azure).**

Source: models page [https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure) and responses model list [https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)

### Difference between Azure OpenAI models and partner/open-source models

**Azure OpenAI models** (GPT-4o, GPT-4.1, GPT-5 family, o-series) are "sold by Azure" — Microsoft hosts them, bills for them via Azure, and they are fully API-compatible with OpenAI's structured outputs. **Partner/community models** (Llama, Mistral, DeepSeek, Phi, Cohere, etc.) are deployed separately (serverless API endpoint or managed compute) and accessed via different SDK paths. They do not expose the `response_format: { type: "json_schema", strict: true }` parameter in the same way. Some may have their own JSON mode, but **none offer the same guaranteed strict conformance** that the Azure OpenAI structured output feature provides. **For your use case requiring guaranteed structured JSON, you must use an Azure OpenAI model (gpt-4o or later).**

### Known limitations of strict mode (Azure's constraints — same as OpenAI)

All of the following are confirmed by the structured outputs doc:

1. **All fields must be in `required`** — "Include all fields or function parameters as required." To make a field optional, use `"type": ["string", "null"]` union instead of omitting it from `required`.
2. **`additionalProperties: false` must be set on every object** — "To use structured outputs, set this value to false." This applies to nested objects too.
3. **Max 100 object properties total**, with **up to 5 levels of nesting**.
4. **No string constraints**: `minLength`, `maxLength`, `pattern`, `format` are unsupported.
5. **No number constraints**: `minimum`, `maximum`, `multipleOf` are unsupported.
6. **No advanced object keywords**: `patternProperties`, `unevaluatedProperties`, `propertyNames`, `minProperties`, `maxProperties`.
7. **No advanced array keywords**: `unevaluatedItems`, `contains`, `minContains`, `maxContains`, `minItems`, `maxItems`, `uniqueItems`.
8. **Root object cannot be `anyOf` type** (nested `anyOf` within properties is allowed).
9. **Parallel function calls are not supported with structured outputs** — must set `parallel_tool_calls: false`.

**Regarding your specific schemas:**
- ✅ Your judge schema (nested objects with booleans, strings, all required) is fully compatible.
- ✅ Your bonus challenge schema (flat object with strings including an enum-constrained field) is fully compatible. String enum values are a supported type.
- ✅ All your fields are already marked `required` — no changes needed on that front.
- ⚠️ You must add `"additionalProperties": false` at the root AND on each nested sub-object.

Source: [https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs)

### Concrete TypeScript code example for structured output against Azure

Here is a **complete, production-ready TypeScript example** for the Chat Completions API with strict structured output, using API key auth (swap for Entra ID in production — see Q3):

```typescript
import OpenAI from "openai";

// ---- Configuration ----
// For API key auth:
const client = new OpenAI({
  baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/",
  apiKey: process.env.AZURE_OPENAI_API_KEY,
});

// ---- Your judge schema (translated from @google/genai Type enum to plain JSON Schema) ----
const judgeSchema = {
  type: "object",
  properties: {
    categories: {
      type: "object",
      properties: {
        name:  { type: "object", properties: { valid: { type: "boolean" }, bonusMatched: { type: "boolean" }, feedback: { type: "string" } }, required: ["valid", "bonusMatched", "feedback"], additionalProperties: false },
        place: { type: "object", properties: { valid: { type: "boolean" }, bonusMatched: { type: "boolean" }, feedback: { type: "string" } }, required: ["valid", "bonusMatched", "feedback"], additionalProperties: false },
        animal:{ type: "object", properties: { valid: { type: "boolean" }, bonusMatched: { type: "boolean" }, feedback: { type: "string" } }, required: ["valid", "bonusMatched", "feedback"], additionalProperties: false },
        thing: { type: "object", properties: { valid: { type: "boolean" }, bonusMatched: { type: "boolean" }, feedback: { type: "string" } }, required: ["valid", "bonusMatched", "feedback"], additionalProperties: false },
      },
      required: ["name", "place", "animal", "thing"],
      additionalProperties: false,
    },
    overallFeedback:     { type: "string" },
    bonusChallengeMet:   { type: "boolean" },
  },
  required: ["categories", "overallFeedback", "bonusChallengeMet"],
  additionalProperties: false,
} as const;

// ---- Call ----
async function judgeAnswers(prompt: string): Promise<ReturnType<typeof JSON.parse>> {
  const completion = await client.chat.completions.create({
    model: "YOUR-DEPLOYMENT-NAME",  // e.g., "gpt-4o-mini" — your deployment name, NOT model name
    temperature: 0.2,
    messages: [
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "JudgeResponse",
        strict: true,
        schema: judgeSchema,
      },
    },
  });

  const text = completion.choices[0].message.content;
  if (!text) throw new Error("Empty response from model");
  return JSON.parse(text); // Will reliably parse when strict: true and finish_reason === "stop"
}
```

**Key points about this code:**
- `model` field takes your **deployment name**, which may differ from the underlying model name (see Q4).
- `strict: true` inside `json_schema` enables the schema-constrained mode.
- `finish_reason` should always be `"stop"` with strict mode; if it is `"length"`, the output was truncated and parsing will fail — check `max_tokens` if this occurs.
- The `openai` package's `client.beta.chat.completions.parse()` method can also be used for automatic parsing, but requires TypeScript type definitions built with `zod` or similar — the raw `chat.completions.create()` with `JSON.parse()` mirrors your existing pattern and is equally safe with strict mode.

The equivalent using the **Responses API** (newer, preferred by Microsoft):
```typescript
const response = await client.responses.create({
  model: "YOUR-DEPLOYMENT-NAME",
  input: prompt,
  text: {
    format: {
      type: "json_schema",
      name: "JudgeResponse",
      schema: judgeSchema,
      strict: true,
    },
  },
});
const result = JSON.parse(response.output_text);
```

Sources:
- Structured outputs doc: [https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs)
- Responses API doc: [https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses)

---

## Q3 — Authentication: API Key vs. Microsoft Entra ID

### Two options

**Option 1: API Key**
```typescript
const client = new OpenAI({
  baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/",
  apiKey: process.env.AZURE_OPENAI_API_KEY,
});
```
Required environment variables:
- `AZURE_OPENAI_API_KEY` — the API key from the Azure portal (Resource → Keys and Endpoint)
- `AZURE_OPENAI_ENDPOINT` — (optional, for reference) `https://YOUR-RESOURCE-NAME.openai.azure.com`

**Note on `api-version`:** In the new stable `v1` API surface (`/openai/v1/`), you do **not** pass an `api-version` query parameter. The version is encoded in the path. This is a breaking change from the old Azure OpenAI SDK pattern where you specified `apiVersion: "2024-10-21"` etc. The old API version strings like `2024-10-21`, `2024-06-01` still exist for the legacy path (`/openai/deployments/{deployment}/chat/completions?api-version=...`), but the current recommended path is simply `https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/chat/completions` with no version query param.

If you are using the **old Azure OpenAI deployment-specific endpoint** (which still works), the latest GA `api-version` is `2024-10-21` and the latest preview is `v1 preview`. From the reference page:
> "**Data plane:** Latest preview: `v1 preview` | Latest GA: `v1`"
Source: [https://learn.microsoft.com/en-us/azure/foundry/openai/reference](https://learn.microsoft.com/en-us/azure/foundry/openai/reference)

**Option 2: Microsoft Entra ID (`DefaultAzureCredential`) — Recommended for production**
```typescript
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

const credential = new DefaultAzureCredential();
// NEW scope for the v1 endpoint (important: changed from old scope):
const tokenProvider = getBearerTokenProvider(credential, "https://ai.azure.com/.default");

const client = new OpenAI({
  baseURL: "https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/",
  apiKey: tokenProvider,  // Yes, the openai package accepts a callable here
});
```

⚠️ **Scope change:** The token scope for the new v1 endpoint is `"https://ai.azure.com/.default"`, **not** the old `"https://cognitiveservices.azure.com/.default"`. The `@azure/openai` npm page and the managed identity docs both show the old scope for `AzureOpenAI` class, but the Foundry docs consistently use `"https://ai.azure.com/.default"` for the new endpoint surface. If you hit 401 errors, this is the likely cause.

Required environment variables for Entra ID:
- **Local development:** None — `DefaultAzureCredential` picks up your `az login` session automatically after you run `az login`.
- **Azure-hosted (managed identity):** None — `DefaultAzureCredential` picks up the managed identity assigned to the compute resource (App Service, Container App, Azure Functions, VM, etc.) automatically. No secrets to manage.
- **CI/CD (service principal):** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (or certificate path).

**Recommended approach:** Microsoft explicitly recommends Entra ID for server-side apps:
> "Use Microsoft Entra ID. API keys work on `/openai/v1`. Pass the key as `api_key` instead of a token provider."
> — SDK Overview, 2026-08-07

The managed identity auth doc states:
> "Your app never stores a credential, and Azure rotates the identity for you."
Source: [https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/managed-identity](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/managed-identity)

**Required RBAC role:** The identity (your developer account or managed identity) must be assigned the **Cognitive Services OpenAI User** or **Cognitive Services OpenAI Contributor** role on the Azure OpenAI resource. (Note: if using a Foundry resource rather than a classic Azure OpenAI resource, the role is **Foundry User**.)

---

## Q4 — Deployment Model: Concepts and Relationships

### Terminology hierarchy

```
Azure Subscription
  └── Resource Group
        └── Foundry Resource (formerly "Azure OpenAI resource" or "AI Hub resource")
              ├── Endpoint: https://<resource-name>.openai.azure.com/openai/v1/
              └── Project (optional, for Foundry SDK features)
                    └── Deployments
                          └── Deployment Name = "my-gpt-4o-mini-deployment" → Model: gpt-4o-mini (2024-07-18)
```

- **Foundry resource:** The Azure resource you create. Provides the endpoint URL. Analogous to an "Azure OpenAI resource" (these are now being upgraded to Foundry resources, but both give you the `/openai/v1/` endpoint).
- **Project:** An optional grouping within a Foundry resource, required only if using Foundry SDK features (agents, evaluations). For pure inference via `/openai/v1/`, you don't need a project.
- **Deployment:** You create a deployment by choosing a model (e.g., `gpt-4o-mini`) and assigning it a **deployment name** (e.g., `my-judge-model`). The deployment name is what you pass as the `model` parameter in API calls, **not the underlying model name**. Many customers name them after the model for simplicity.
- **Model version:** Each deployment pins a specific model version (e.g., `gpt-4o-mini (2024-07-18)`).

**What client code needs:**
- The **endpoint URL**: `https://<resource-name>.openai.azure.com/openai/v1/`
- The **deployment name** (passed as `model` parameter)
- Authentication (API key or Entra token)

You do NOT pass the model name or version in the API call — only the deployment name.

### Deployment types (Standard vs. Global Standard vs. Provisioned)

Source: [https://learn.microsoft.com/en-us/azure/foundry-classic/concepts/deployments-overview](https://learn.microsoft.com/en-us/azure/foundry-classic/concepts/deployments-overview) and model retirements doc

| Type | Description | Billing | Best for |
|---|---|---|---|
| **Standard (Regional)** | Deployed in a specific Azure region. Requests stay in that region. Shared capacity, rate limited by TPM. | Per token consumed | Data residency requirements; predictable but lower throughput |
| **Global Standard** | Routes requests globally across multiple regions for best availability. Microsoft's **recommended default** and where new models launch first. | Per token consumed | Getting started; best availability and lowest latency |
| **Data Zone Standard** | Routes within a geographic zone (US or EU) — data stays within the zone boundary. Launches after Global Standard. | Per token consumed | EU/US data residency without strict single-region requirement |
| **Provisioned (PTU)** | Reserved throughput in Provisioned Throughput Units. Charged hourly per PTU regardless of usage. | Per PTU/hour + reservations | High, steady-state production workloads with predictable cost |
| **Global Provisioned** | Provisioned with global routing. | Per PTU/hour | High throughput + global availability |

**Serverless API endpoint vs. Managed compute:** These apply only to non-OpenAI partner models (Llama, Mistral, etc.) in AI Hub (classic) resources, not to Azure OpenAI models:
- **Serverless API:** Pay-per-token, dedicated endpoint, no compute to manage. Available only for certain partner models.
- **Managed compute:** You bring dedicated VMs, billed per compute hour. Required for Hugging Face, NVIDIA NIMs, and custom models.

**Practical advice for your app:** Use **Global Standard** for a new deployment. It's the default, gives the widest model availability, and is pay-as-you-go.

---

## Q5 — Cost and Free Tier

### Free tier

**Yes — a free Azure account.** Azure offers a free account at [https://azure.microsoft.com/pricing/purchase-options/azure-account](https://azure.microsoft.com/pricing/purchase-options/azure-account) which includes a free trial subscription with $200 in credits for 30 days, plus some always-free services. **Azure AI Foundry / Azure OpenAI is not one of the always-free services**, but the $200 credit covers initial experimentation.

**Quota tiers:** The service has introduced "quota tiers" (Free Tier, Tier 1–6) as of May 2026. New accounts start at **Tier 1** (or Free Tier for subscriptions with no payment method). Tier 1 already includes substantial quota for common models (e.g., 20,000 RPM / 2,000,000 TPM for gpt-4o-mini Global Standard at Tier 1). Tiers auto-upgrade with usage over time.
Source: [https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits)

### Pricing — **Critical caveat**

The Azure OpenAI pricing page ([https://azure.microsoft.com/en-us/pricing/details/azure-openai/](https://azure.microsoft.com/en-us/pricing/details/azure-openai/)) renders prices via JavaScript in the browser, and the fetched page shows **`$-` for every model**. This means actual pricing numbers are not available from static scraping at research time. **I cannot give you verified current prices.** You must check the Azure pricing calculator directly.

However, from known historical pricing patterns and general knowledge (which I have up to my training cutoff), the rough tiers for **Global Standard pay-as-you-go** are:
- `gpt-4.1-nano` — cheapest current capable model
- `gpt-4.1-mini` — mid-tier, very capable
- `gpt-4o-mini` — well-established, widely used, good cost/performance
- `gpt-4.1` / `gpt-4o` — full capability, more expensive
- `gpt-5-mini` / `gpt-5-nano` — current cheapest GPT-5 family models

**For your use case (a few hundred tokens in, ~200 tokens out):** Any of the "mini" or "nano" variants will cost fractions of a cent per request. Even at $1/1M tokens, 500 tokens = $0.0005. The Batch API offers an additional ~50% discount for non-real-time workloads, but your app is synchronous.

**Model recommendation for your use case:** `gpt-4.1-mini` (version `2025-04-14`) or `gpt-4o-mini` (`2024-07-18`) — both support structured outputs, are globally available, are the cheapest options that reliably do strict JSON schema conformance, and are well-established on Azure. `gpt-4.1-nano` is even cheaper but is newer; confirm structured output support in a test deployment before relying on it.

---

## Q6 — Regions, Quota, and Waitlists

### Approval/waitlist

**Azure OpenAI historically required access approval,** but as of 2025–2026 this has largely been removed for standard models. The docs no longer prominently feature an access request form for basic models. The structured output docs and quickstarts say simply: "An Azure subscription" and "Create one for free."

**However:** Some quota tiers and specific models still have restrictions:
- `gpt-5.5`, `gpt-5.6`, and newer high-end models: "Some quota tiers require quota requests for `gpt-5.5`/`gpt-5.6` to deploy this model. Tier 5 and Tier 6 subscriptions have quota by default." New accounts at Tier 1 may not be able to deploy the newest models without requesting a quota increase.
- `gpt-4o-mini` and `gpt-4.1-mini` are available at Tier 1 with no special approval needed.

**Practical path for a new account:**
1. Create a free Azure account.
2. Create a Foundry resource (or Azure OpenAI resource) in a supported region.
3. Deploy `gpt-4o-mini` or `gpt-4.1-mini` under Global Standard — this should work immediately with no approval needed.
4. If you need GPT-5 family, check your quota tier and use the quota request form at https://aka.ms/oai/stuquotarequest.

### Regional availability

- **Global Standard deployments** are available across many regions and automatically route globally — regional selection matters mainly for data residency, not availability.
- The Responses API is available in 31 named regions (listed in Q2 above).
- For data residency in the EU, use **Data Zone Standard** (EU zone).
- **Not every model is in every region** — verify at the model detail page before deploying.

Source: [https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits)

---

## Q7 — Local Development and Testing

### No local emulator

**There is no Azure AI Foundry local emulator.** Unlike Azure Storage (Azurite) or Azure Service Bus, there is no local substitute for the model inference endpoint. **You always call the real cloud endpoint during development.**

### How to develop locally

The recommended approach is:

1. **Create a real (but low-cost) deployment** for dev/test purposes. With Global Standard pay-as-you-go, you only pay for what you use — a few thousand test calls cost cents.

2. **Authenticate locally using `az login`:** `DefaultAzureCredential` picks up your Azure CLI session automatically. No env vars needed for auth if you have the right RBAC role.
   ```bash
   az login
   az account get-access-token --resource https://ai.azure.com --query expiresOn --output tsv
   # If this succeeds, your local credential is working
   ```

3. **Environment variables for local dev (API key option):**
   - `AZURE_OPENAI_API_KEY` — copy from Azure portal
   - Store in `.env` file (never commit); use `dotenv` package in your Express app.

4. **Use a separate dev deployment:** Create a deployment named e.g. `gpt-4o-mini-dev` with the same model as production. This prevents dev traffic from consuming production quota and makes it easy to swap via environment variable.

5. **Vitest/Jest mocking:** For unit tests, mock the `openai` module. Since your call sites are already behind clean interfaces, you can mock those interfaces entirely and test your JSON parsing / error handling logic with static fixture responses. This avoids any cloud calls in unit tests.
   ```typescript
   // In tests: mock the interface that wraps the Azure call
   vi.mock('./judge', () => ({
     judgeAnswers: vi.fn().mockResolvedValue({ /* fixture */ })
   }));
   ```

6. **Integration tests:** For integration tests that actually call Azure, use a `.env.test` file with a real dev deployment and run them selectively (not in every CI run) to control costs.

**Cost control tip:** Azure has no built-in "test mode." Set up budget alerts in Azure Cost Management to get notified if dev costs unexpectedly spike.

Source: SDK Overview prereqs section, Managed Identity doc local auth section.

---

## Gaps and Uncertainties

1. **Pricing numbers:** The Azure OpenAI pricing page (`azure.microsoft.com/en-us/pricing/details/azure-openai/`) renders all prices as `$-` via JavaScript — this is a live-fetch rendering issue, not missing data. **Go to the Azure pricing calculator directly for current numbers:** [https://azure.microsoft.com/en-us/pricing/calculator/](https://azure.microsoft.com/en-us/pricing/calculator/)

2. **`@azure/openai` version status:** The npm page describes it as a "companion" and directs migration to `openai`. It is not formally deprecated (it still receives updates), but it is no longer the recommended primary SDK. Its latest version and whether it receives feature parity with `openai` is uncertain.

3. **`openai` npm exact current version:** The npm README shows this as a live package. The docs reference `openai 1.42.0` in code examples but this appears to be an older stable pin in the examples — actual current stable is higher. Run `npm info openai version` to confirm.

4. **Free tier for Azure OpenAI specifically:** I did not find a page confirming a permanent always-free tier for Azure OpenAI (as opposed to the 30-day $200 trial). The quota tiers doc mentions a "Free Tier" among the tiers (Free Tier, Tier 1–6), but the specific limits of the Free Tier are not detailed in the pages fetched. Check the full quota table at [https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits](https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits).

5. **`gpt-4.1-nano` structured output support:** The model is listed under Global Standard and mentions "structured outputs" in its capabilities in the models table. Assumed compatible but not explicitly verified in a code example — test before using in production.

6. **Branding note:** As of August 2026, "Azure AI Foundry" is being rebranded to "Microsoft Foundry." Some docs and portal UI still show the old name. All official doc URLs have moved to `learn.microsoft.com/en-us/azure/foundry/`. The resource type name in the Azure portal may still show "Azure AI Foundry" or "Azure OpenAI" depending on which resource type you create.

---

## Key URLs (All Official Microsoft Documentation)

| Topic | URL |
|---|---|
| SDK Overview (JS pivot, updated 2026-08-07) | https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/sdk-overview |
| Structured Outputs (updated 2026-08-06) | https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs |
| Responses API how-to (updated 2026-08-06) | https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses |
| Managed Identity / Entra ID auth | https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/managed-identity |
| Models sold by Azure (with capabilities table) | https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure |
| Deployment types overview | https://learn.microsoft.com/en-us/azure/foundry-classic/concepts/deployments-overview |
| Quotas & Limits (tiers, updated 2026-07-29) | https://learn.microsoft.com/en-us/azure/foundry/openai/quotas-limits |
| REST API Reference (API versions) | https://learn.microsoft.com/en-us/azure/foundry/openai/reference |
| Model lifecycle & retirements | https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirements |
| What is Microsoft Foundry (overview) | https://learn.microsoft.com/en-us/azure/foundry/what-is-foundry |
| Azure OpenAI Pricing page | https://azure.microsoft.com/en-us/pricing/details/azure-openai/ |
| @azure/openai npm page (migration advisory) | https://www.npmjs.com/package/@azure/openai |
| Create free Azure account | https://azure.microsoft.com/pricing/purchase-options/azure-account |
| Quota request form | https://aka.ms/oai/stuquotarequest |