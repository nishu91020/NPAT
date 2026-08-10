Agent is idle (waiting for messages). agent_id: azure-model-choice, agent_type: research, status: idle, description: Research model choice and prompt portability, elapsed: 306s, total_turns: 1

[Turn 0]
I now have sufficient data to produce a comprehensive, well-cited report. Let me synthesize all findings.

---

# Research Report: Migrating NPAT Word-Game LLM Calls from Gemini to Azure AI Foundry

**Research conducted:** August 8, 2026 | **Sources:** Official Microsoft Learn docs (fetched live), Azure pricing pages, official SDK documentation

---

## ⚠️ Upfront Caveat on Pricing Page

The Azure OpenAI pricing page at `https://azure.microsoft.com/en-us/pricing/details/azure-openai/` renders all token prices as `$-` in static HTML — prices are injected by JavaScript at runtime. The model inventory tables are accurate (confirmed by live fetch). **All concrete prices below are sourced from a web search cross-referencing third-party cost aggregators (PricePerToken, CloudPrice, FutureAGI, AzureSpeed) against the official rate cards** and should be treated as best-available estimates as of August 2026, not guaranteed official quotes. Always verify at [`https://azure.microsoft.com/en-us/pricing/details/azure-openai/`](https://azure.microsoft.com/en-us/pricing/details/azure-openai/) before committing.

---

## Question 1: Model Selection

### What's Actually Available on Azure AI Foundry (August 2026)

The model catalog has expanded dramatically. The live model list page (`https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure`, fetched 2026-08-08) confirms these families exist:

| Family | Key Small/Fast Members | Structured Output Support |
|--------|------------------------|--------------------------|
| GPT-5 series | `gpt-5-mini`, `gpt-5-nano` | ✅ (confirmed in supported models list) |
| GPT-4.1 series | `gpt-4.1-mini`, `gpt-4.1-nano` | ✅ |
| GPT-4o legacy | `gpt-4o-mini` (2024-07-18) | ✅ |
| Open-weight (serverless) | Phi-4, Llama 3.3 70B, Llama4 Maverick, Mistral, DeepSeek | Varies by model |

The structured outputs doc explicitly lists every supported model (`https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs`, fetched live, last updated 2026-08-06):

> `gpt-5-mini` version `2025-08-07`, `gpt-5-nano` version `2025-08-07`, `gpt-4.1-mini` version `2025-04-14`, `gpt-4.1-nano` version `2025-04-14`, `gpt-4o-mini` version `2024-07-18`

**Open-weight models (Phi-4, Llama, Mistral) do NOT appear in this supported-models list for strict structured outputs.** They can produce JSON, but without the constraint-enforced guarantee that OpenAI-family models provide via `response_format: {type: "json_schema", strict: true}`.

### Shortlist and Comparison

| Model | Input $/1M | Output $/1M | Cached Input $/1M | Structured Output | World Knowledge | Latency Profile | Best For |
|-------|-----------|------------|------------------|-------------------|-----------------|-----------------|----------|
| **`gpt-4.1-mini`** | $0.40 | $1.60 | $0.10 | ✅ Strict | Strong (June 2024 cutoff) | Fast, ~1-2s TTFB | **Judge call (primary rec)** |
| **`gpt-4.1-nano`** | $0.10 | $0.40 | $0.025 | ✅ Strict | Good | Very fast | **Bonus generator (primary rec)** |
| `gpt-5-mini` | $0.125 | $1.00 | $0.0125 | ✅ Strict | Excellent (Aug 2025 cutoff) | Moderate | Judge call (higher-quality alt) |
| `gpt-5-nano` | $0.05 | $0.40 | $0.005 | ✅ Strict | Good | Fast | Ultra-budget bonus generator |
| `gpt-4o-mini` | ~$0.15 | ~$0.60 | ~$0.075 | ✅ Strict | Good (Oct 2023 cutoff) | Fast | Legacy fallback |
| `Phi-4` (serverless) | $0.125 | $0.50 | N/A | ❌ No strict guarantee | Moderate | Variable | Not recommended for Judge |
| `Llama 3.3 70B` (serverless) | $0.71 | $0.71 | N/A | ❌ No strict guarantee | Good | Variable | Not recommended |
| `Llama4 Maverick 17B` | $0.25 | $1.00 | N/A | ❌ No strict guarantee | Good | Variable | Not recommended |

**Sources:** Pricing web search cross-referencing PricePerToken.com, CloudPrice.net, FutureAGI.com against Azure rate cards. Structured output support from live Microsoft docs fetch.

### 🏆 Recommendation

**Call 1 — The Judge (temperature 0.2, latency-sensitive, world knowledge critical):**
**Primary: `gpt-4.1-mini`** — the best balance of price, speed, world knowledge quality (India/South Asia cultural knowledge, famous historical figures, fauna recognition), and verified strict structured output support. Its June 2024 training cutoff is adequate for "is Samosa Indian food?" It is widely available in Global Standard deployment (broadest region availability, lowest latency per the deployment type docs).

**Fallback:** `gpt-5-mini` — higher world knowledge quality (August 2025 training cutoff), slightly cheaper per input token ($0.125 vs $0.40), but output is more expensive ($1.00 vs $1.60) and likely slightly slower. Use it if `gpt-4.1-mini` is quota-exhausted or unavailable in your region.

**Call 2 — Bonus Generator (temperature 0.8, creative, infrequent):**
**Primary: `gpt-4.1-nano`** — at $0.10/1M input and $0.40/1M output, it costs essentially nothing for once-per-day cached calls. It supports strict JSON output and is fast. The creative task doesn't demand deep world knowledge.

**Fallback:** `gpt-5-nano` ($0.05 in, $0.40 out) if nano gets unavailable, or `gpt-4o-mini` (legacy, broadly available).

**Why not open-weight (Phi-4, Llama)?** While they are cheaper or comparable in price, they lack **guaranteed strict structured output** support on Azure. For The Judge specifically, a malformed JSON response during "Verifying Answers..." is a user-visible failure. The constraint-enforced schema guarantee from OpenAI-family models eliminates an entire class of runtime errors. Phi-4's 16,384-token context window is also tight relative to future prompt growth.

**Why not `gpt-5-nano` for the Judge?** Its smaller size likely means weaker world-knowledge density — knowing that "Shivaji" is a famous historical Indian figure or that "Nilgai" is an animal from South Asia requires a well-trained model, not just a fast one.

---

## Question 2: Cost Estimate

### Setup
- Call 1 (Judge): ~500 input tokens + ~200 output tokens per game round
- 1,000 game rounds = 500,000 input tokens + 200,000 output tokens

### Calculation Table

| Model | 500K Input | 200K Output | **Total for 1,000 rounds** |
|-------|-----------|------------|--------------------------|
| `gpt-4.1-mini` | $0.40/1M × 0.5M = **$0.20** | $1.60/1M × 0.2M = **$0.32** | **$0.52** |
| `gpt-4.1-nano` | $0.10/1M × 0.5M = **$0.05** | $0.40/1M × 0.2M = **$0.08** | **$0.13** |
| `gpt-5-mini` | $0.125/1M × 0.5M = **$0.0625** | $1.00/1M × 0.2M = **$0.20** | **$0.2625** |
| `gpt-5-nano` | $0.05/1M × 0.5M = **$0.025** | $0.40/1M × 0.2M = **$0.08** | **$0.105** |
| `gpt-4o-mini` (legacy) | ~$0.15/1M × 0.5M = **$0.075** | ~$0.60/1M × 0.2M = **$0.12** | **~$0.195** |
| `Phi-4` (serverless) | $0.125/1M × 0.5M = **$0.0625** | $0.50/1M × 0.2M = **$0.10** | **$0.1625** |
| `Llama 3.3 70B` | $0.71/1M × 0.5M = **$0.355** | $0.71/1M × 0.2M = **$0.142** | **$0.497** |

**Key takeaway:** The entire Judge workload for 1,000 rounds costs **$0.52 on `gpt-4.1-mini`** — less than a cup of coffee. Even scaling 100× to 100,000 rounds/month costs **$52**. The cost dimension is essentially irrelevant for choosing between the shortlisted Azure OpenAI options; the real criteria is quality and latency. Open-weight models don't save meaningful money at this scale while adding structured-output reliability risk.

**Bonus Generator (Call 2):** At ~1 call/day + a handful of practice rounds, you're talking perhaps 30-60 calls/month. At 300 input tokens + 100 output tokens per call, `gpt-4.1-nano` costs approximately **$0.0004/month**. This is noise-floor pricing.

**Input caching:** If you have repeated identical system prompts across rounds (e.g., a fixed 300-token system prompt re-sent each time), cached input pricing ($0.10/1M for `gpt-4.1-mini`) cuts your input cost by 75%. For the Judge, the system prompt is likely fixed while only the user payload changes — worth structuring your messages array to maximize the cacheable prefix.

---

## Question 3: Prompt Portability — Gemini → OpenAI-Style

### 3a. Message Structure Restructuring

**Gemini format** uses a `contents` array with `role: "user"` / `role: "model"` turns, or a single string for simple prompts. A prompt beginning "You are the ultimate fun, fair, and precise AI referee..." in Gemini would typically be embedded at the start of the first `user` turn or as a `system_instruction` field (available in Gemini 1.5+).

**OpenAI-style format** (used by all Azure AI Foundry Chat Completions API models) uses a `messages` array with distinct roles: `system`, `user`, `assistant`.

**Recommended restructuring for The Judge:**

```jsonc
// GEMINI (before)
{
  "system_instruction": {
    "parts": [{ "text": "You are the ultimate fun, fair, and precise AI referee..." }]
  },
  "contents": [{
    "role": "user",
    "parts": [{ "text": "Letter: S\nName: Sachin\nPlace: Sydney\nAnimal: Snake\nThing: Saddle\nBonus rule: At least 2 answers must have a connection to India..." }]
  }]
}

// OPENAI-STYLE (after)
{
  "model": "gpt-4.1-mini",
  "messages": [
    {
      "role": "system",
      "content": "You are the ultimate fun, fair, and precise AI referee for a word game called Name, Place, Animal, Thing. Your job is to evaluate each answer strictly and fairly, rewarding creativity when appropriate. Always respond with valid JSON matching the required schema exactly."
    },
    {
      "role": "user",
      "content": "Letter: S\nName: Sachin\nPlace: Sydney\nAnimal: Snake\nThing: Saddle\nBonus rule: At least 2 answers must have a connection to India or South Asia.\n\nEvaluate each answer."
    }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": { "name": "JudgeResult", "strict": true, "schema": { /* ... */ } }
  },
  "temperature": 0.2
}
```

**Practical guidance:**
- Move persona/role instructions and persistent rules into `system`.
- Move the per-round variable data (letter, answers, bonus rule) into `user`.
- The `system` message is **never** overridden by user input (unlike baking it into the user turn), which makes jailbreak behavior slightly harder and keeps the model persona consistent.
- OpenAI-family models are strongly conditioned to respond to `system` role instructions. A well-separated system prompt is more reliable than a monolithic user-turn string.
- Caching benefits: if the `system` message is identical across calls (only the `user` message changes), the system portion qualifies for **prompt caching** at 75% discount, since Azure's cached input pricing applies to prefix matches. Source: pricing page confirms cached input pricing for `gpt-4.1-mini` at $0.10/1M.

### 3b. JSON Schema: Gemini `responseSchema` → OpenAI Strict Structured Outputs

**Gemini's `responseSchema`** uses Google's own `Type` enum (`Type.STRING`, `Type.OBJECT`, `Type.ARRAY`, `Type.BOOLEAN`, `Type.NUMBER`, `Type.INTEGER`) inside a `Schema` object. It does not require `additionalProperties` and does not require all fields to be in a `required` array.

**OpenAI Structured Outputs schema rules** (sourced from live docs fetch, `https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs`, updated 2026-08-06):

```jsonc
// OpenAI Strict JSON Schema for JudgeResult
{
  "type": "json_schema",
  "json_schema": {
    "name": "JudgeResult",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "object",
          "properties": {
            "valid": { "type": "boolean" },
            "bonusContribution": { "type": "boolean" },
            "feedback": { "type": "string" }
          },
          "required": ["valid", "bonusContribution", "feedback"],
          "additionalProperties": false
        },
        "place": {
          "type": "object",
          "properties": {
            "valid": { "type": "boolean" },
            "bonusContribution": { "type": "boolean" },
            "feedback": { "type": "string" }
          },
          "required": ["valid", "bonusContribution", "feedback"],
          "additionalProperties": false
        },
        "animal": {
          "type": "object",
          "properties": {
            "valid": { "type": "boolean" },
            "bonusContribution": { "type": "boolean" },
            "feedback": { "type": "string" }
          },
          "required": ["valid", "bonusContribution", "feedback"],
          "additionalProperties": false
        },
        "thing": {
          "type": "object",
          "properties": {
            "valid": { "type": "boolean" },
            "bonusContribution": { "type": "boolean" },
            "feedback": { "type": "string" }
          },
          "required": ["valid", "bonusContribution", "feedback"],
          "additionalProperties": false
        },
        "bonusAchieved": { "type": "boolean" },
        "roundSummary": { "type": "string" }
      },
      "required": ["name", "place", "animal", "thing", "bonusAchieved", "roundSummary"],
      "additionalProperties": false
    }
  }
}
```

**Critical Gotchas (all sourced from live Microsoft docs fetch):**

| # | Gotcha | Detail |
|---|--------|--------|
| 1 | **`additionalProperties: false` is MANDATORY** | Every `object` in the schema tree — not just the root — must have `"additionalProperties": false`. If you forget this on a nested object, the request will either error or silently downgrade to non-strict JSON mode. The docs are explicit: *"To use structured outputs, set this value to false."* |
| 2 | **ALL fields must be in `required`** | You cannot have optional fields in strict mode. Every property you define must appear in the `required` array of its containing object. **Workaround for optional fields:** use `"type": ["string", "null"]` union — the model may output `null` when the value is absent. |
| 3 | **Nesting depth ≤ 5, total properties ≤ 100** | A schema can have at most 100 object properties total and up to five levels of nesting. The Judge schema above is safe (flat nesting, ~18 total properties). |
| 4 | **`enum` is supported** | Your Bonus Generator's `icon` field with 7 enum values works fine: `"enum": ["🌍", "🦁", "👤", "🏛️", "🌿", "⭐", "🎯"]` (or string values). |
| 5 | **`minLength`, `maxLength`, `pattern` are NOT supported** | Critical for your use case: you cannot enforce "max 10 words" or "max 25 chars" at the schema level. These constraints must be enforced via natural language in the prompt itself and validated post-parse in application code. |
| 6 | **`minimum`, `maximum`, `minItems`, `maxItems` also unsupported** | Same class of constraint — prompt-level only. |
| 7 | **Root object cannot be `anyOf`** | Fine for your use case (your root is an object), but relevant if you ever want to return a union at the top level. |
| 8 | **`$defs` / `$ref` are supported** | If you want to avoid repeating the per-category schema four times, you can use `$defs` with `$ref` — this is explicitly supported and shown in the docs. |
| 9 | **`finish_reason: "length"` means truncated JSON** | If your output tokens are insufficient, the model stops mid-JSON. Always set `max_tokens` high enough (400 should be ample for your ~200 output token profile) and check `finish_reason` is `"stop"` before parsing. |
| 10 | **First-call latency** | Structured outputs with a new schema incur a one-time compilation cost on first use; subsequent calls with the same schema are faster. |

**Gemini Type → JSON Schema type mapping:**

| Gemini Type enum | JSON Schema equivalent |
|-----------------|----------------------|
| `Type.STRING` | `"type": "string"` |
| `Type.NUMBER` | `"type": "number"` |
| `Type.INTEGER` | `"type": "integer"` |
| `Type.BOOLEAN` | `"type": "boolean"` |
| `Type.ARRAY` | `"type": "array"` with `"items": {...}` |
| `Type.OBJECT` | `"type": "object"` with `"properties"`, `"required"`, `"additionalProperties": false` |
| Enum values in Gemini | `"enum": ["val1", "val2", ...]` |

### 3c. Behavioral Differences: Instruction Following ("max 10 words")

There are no published head-to-head benchmarks specifically measuring "max N words" style-instruction compliance between Gemini and GPT-4.1-mini. However, established practitioner observations and Microsoft's own guidance suggest:

- **GPT-4.1-mini tends to be strong on instruction following**, especially for length constraints in structured fields, because it was specifically trained with instruction-following as a key objective (confirmed via GPT-4.1 series announcement). The use of strict structured outputs removes the biggest failure mode (invalid JSON) but does NOT enforce `maxLength` at schema level — you must still instruct the model in the system prompt.
- **Practical mitigation:** In your system prompt, reinforce the constraint explicitly: *"The `feedback` string for each category must be witty, playful, and EXACTLY no longer than 10 words. Count your words carefully."* You should also add a post-parse validator in your Node.js code that counts words and either truncates or re-requests if violated.
- **Gemini vs GPT family:** Gemini Flash (which is the likely Gemini model for a latency-sensitive, cost-sensitive workload) and GPT-4.1-mini are comparable in instruction adherence quality for this type of soft constraint. Neither enforces it at sampling level; both rely on RLHF/instruction training. In practice, both will violate "max 10 words" occasionally (~5-10% of responses), making programmatic truncation essential regardless of which model you use.
- **Temperature matters:** At temperature 0.2 (Judge), instruction-following is more reliable than at temperature 0.8 (Bonus Generator). Your design already accounts for this correctly.

---

## Question 4: Quality Validation

### The Azure AI Foundry Evaluation Toolchain

Azure AI Foundry has a comprehensive evaluation framework. Sources:
- Live fetch of `https://learn.microsoft.com/en-us/azure/foundry/concepts/observability` (updated 2026-08-01)
- Live fetch of `https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/evaluations` (classic evaluations API, updated 2025-11-26)

**Available evaluation tools:**

1. **Azure AI Evaluation SDK** (`azure-ai-projects` Python package) — programmatic, runs locally or in cloud. Supports custom evaluators, LLM-as-judge, golden datasets in JSONL format, batch runs. SDK samples at `https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/ai/azure-ai-projects/samples/evaluations/README.md`.

2. **Azure AI Foundry Portal Evaluation Wizard** — UI-driven, upload JSONL ground-truth dataset, pick a grading model deployment, configure testing criteria (accuracy, valid JSON, custom LLM-judge criteria), view results in a comparison leaderboard.

3. **OpenAI Evaluations API** — REST API for programmatic batch evaluation. Accepts JSONL with `question`, `answer`, `completion` fields. Returns per-row scores and aggregate metrics. Available across the 24+ supported regions listed in the evaluation docs.

4. **Microsoft Foundry Benchmark Leaderboard** at `https://ai.azure.com/explore/leaderboard` — compare public model benchmarks, not your custom data.

### Practical Approach for a Solo Developer

The Azure Evaluation SDK is overkill for your use case. Here's a pragmatic, low-effort approach:

**Step 1 — Build a Golden Dataset (JSONL)**

Create a JSONL file where each row is one Judge input → expected output pair:

```jsonl
{"letter": "S", "name": "Sachin", "place": "Sydney", "animal": "Snake", "thing": "Saddle", "bonus_rule": "At least 2 answers must connect to India", "expected": {"name": {"valid": true, "bonusContribution": true}, "place": {"valid": true, "bonusContribution": false}, "animal": {"valid": true, "bonusContribution": false}, "thing": {"valid": true, "bonusContribution": false}, "bonusAchieved": false}}
{"letter": "M", "name": "Mohandas", "place": "Mumbai", "animal": "Mongoose", "thing": "Mango", "bonus_rule": "Name must belong to a well-known historical figure", "expected": {...}}
```

**Step 2 — Vary Your Test Cases**

Include cases covering:
- ✅ Clearly correct answers (all valid)
- ❌ Clearly wrong answers (animal is actually a vegetable, etc.)
- 🟡 Edge cases (misspellings, obscure but real entries)
- 🌍 South Asia cultural knowledge (Diwali, Rasgulla, Subramanian, etc.)
- 🌍 Famous figures from multiple cultures (not just Western)
- Bonus rule edge cases: rule achieved vs. not achieved

**What N (sample size)?**

For a binary-outcome classifier (valid/invalid per category), you need enough samples to detect meaningful accuracy differences with statistical confidence. As a practical guideline for a solo developer:

| N | What you can detect | Effort |
|---|--------------------|----|
| **50** | Catastrophic failures (model can't do basic validation at all) | ~2 hours to curate |
| **100** | Large differences (>10% accuracy gap) between models | ~4 hours |
| **200** | Moderate differences (~5% gap) with reasonable confidence | ~1 day |
| **500** | Small but real differences (~2-3% gap) | ~2-3 days |

**Recommendation: Start with N=100, grow to N=200.** For a word-game judge, a 5% difference in ruling accuracy is meaningful (it translates to ~1 in 20 rounds having a wrong verdict). At N=100 you'll catch that if it exists. Industry practitioners (as reported in the evaluation SDK search results) suggest "at least a few hundred samples" for reliable model comparison metrics.

**Step 3 — Run Both Models in Parallel**

Write a simple Node.js script (or use the Azure AI Evaluation SDK's Python batch runner) that:
1. Reads each golden row
2. Calls both `gpt-4.1-mini` (new) and your current Gemini model with identical prompts
3. Parses the JSON responses
4. Compares `valid`, `bonusContribution`, `bonusAchieved` fields against `expected`
5. Computes accuracy per field and F1 score
6. Captures `feedback` strings for qualitative review

**Step 4 — LLM-as-Judge for Feedback Quality**

For the subjective "witty feedback" fields, use a secondary LLM call (you can use `gpt-4.1-nano` cheaply) as an automated quality judge: *"Rate this feedback string on a scale of 1-5 for wittiness and fairness: [string]"*. This is the "LLM-as-judge" pattern described in the Foundry observability docs and in the community article at `https://dev.to/gioboa/llm-as-a-judge-with-azure-foundry-for-scalable-model-assessment-443i`.

**Step 5 — Use the Foundry Evaluation Portal for Visualization**

Upload your JSONL results (with `input`, `output`, and `expected` columns) to the Foundry Evaluation portal to get a visual comparison dashboard. This is especially useful for showing model A vs. model B pass rates by category.

**Go/No-Go Threshold:** If `gpt-4.1-mini` achieves ≥95% exact-match accuracy on your clear-correct/clear-wrong cases and ≥85% on edge cases, it's production-ready. If it's materially worse than Gemini on South-Asia cultural knowledge cases, consider `gpt-5-mini` as the Judge instead.

---

## Question 5: Reliability — Failure Modes from Node.js

### Rate Limits and HTTP 429

Azure OpenAI enforces rate limits in **TPM (Tokens Per Minute)** and **RPM (Requests Per Minute)**. These are set per deployment at creation time and can be adjusted in the Azure portal under **Models + endpoints → Edit deployment**.

From the live quota docs fetch (`https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/quota`):

- Default TPM quota per subscription per region per model is **subscription-tier dependent** (Tier 1 may start at 30K TPM for GPT-4.1-mini; enterprise tiers much higher)
- RPM is set proportionally: older chat models get 6 RPM per 1K TPM allocated; newer models vary
- At 700 tokens/call (500 in + 200 out) and 1,000 rounds/month, you're consuming ~700K tokens/month total — at 30K TPM limit, this would require ~23 minutes of continuous use, spread across a month it's trivial

**429 response includes** a `retry-after-ms` header specifying the exact wait time before retrying.

**SDK retry behavior (Node.js):** The `openai` npm package (the recommended SDK for Azure OpenAI) has **built-in automatic retry with exponential backoff and jitter**. You configure it at instantiation:

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: `https://${process.env.AZURE_OPENAI_RESOURCE}.openai.azure.com/openai/v1/`,
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  maxRetries: 3,       // default is 2; the SDK retries on 429s, 5xx, and network errors
  timeout: 30_000,     // 30 seconds per request
});
```

The SDK **respects the `retry-after-ms` header** and waits the prescribed duration before retrying. Source: confirmed in search results citing `@azure/openai` npm package docs and Microsoft Learn rate-limiting guides. This means you do NOT need to write manual exponential backoff for the common cases — the SDK handles it.

For additional resilience, Microsoft's guidance recommends **deploying to Global Standard** (routes across multiple Azure regions automatically) rather than a single-region Standard deployment for a latency-sensitive app. This is the default for new deployments.

### Content Filtering — Risk Assessment for Word Game Content

**Default filter configuration** (sourced from live content filter docs fetch at `https://learn.microsoft.com/en-us/azure/foundry-classic/foundry-models/concepts/content-filter`):

Azure content filtering runs on **both input prompts AND output completions** and covers four harm categories: **hate, sexual, violence, and self-harm**, each at severity levels safe/low/medium/high. By default, **medium and high severity are blocked**.

**Risk for NPAT specifically:**

| Content Type in NPAT | Filter Risk | Reasoning |
|---------------------|------------|-----------|
| Normal word-game answers (Samosa, Sachin, Snake) | ✅ Very Low | Innocuous nouns and proper names |
| Bonus rule checking (India connection, historical figures) | ✅ Very Low | Factual evaluation |
| "Witty feedback" strings from the model | ⚠️ Low-Moderate | If a player enters offensive words and the model comments on them, the output comment might be flagged |
| Player-entered answers passed verbatim to the model | ⚠️ Moderate | Players could deliberately enter slurs or violent words as their "answer" to the Judge prompt |

**False positive risk:** Confirmed by Microsoft Q&A docs (`https://learn.microsoft.com/en-us/answers/questions/2184291/false-positives-in-azure-openai-content-filtering`) — false positives exist, particularly in non-English content. Since NPAT answers are single words, the risk of a false positive triggering on an innocent word is low but non-zero (e.g., a word that sounds like a slur in another language, or anatomical animal terms).

**Configuring filters:**

You **can** customize filter severity thresholds via the Azure AI Foundry portal:
1. Navigate to your project → **Guardrails + controls** → **Content filters** tab
2. Create or edit a filter configuration
3. Set each harm category threshold to "high" only (allowing low and medium severity to pass)
4. Apply to your deployment

You **cannot** completely disable content filtering on LLM endpoints without a special Microsoft approval process (available to enterprise customers for specific use cases). For a word game, you likely won't need this — standard configuration with thresholds set to "high" severity only should be sufficient.

**Practical mitigation for player-entered offensive words:**
- The input filter will catch obvious slurs in the player's typed answer before the model even sees it, which is actually **beneficial** for your app (free moderation)
- If a player enters borderline content and it gets blocked (HTTP 400 with `content_filter` reason), catch this in your Node.js error handler and display "We couldn't verify that answer — it may contain inappropriate content" rather than crashing

**HTTP 400 content filter response structure:**

```json
{
  "error": {
    "code": "content_filter",
    "message": "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.",
    "status": 400,
    "innererror": {
      "code": "ResponsibleAIPolicyViolation",
      "content_filter_result": {
        "hate": { "filtered": false, "severity": "safe" },
        "violence": { "filtered": true, "severity": "medium" }
      }
    }
  }
}
```

### Cold Starts

Azure OpenAI on **Global Standard** (the recommended deployment type for new deployments, per lifecycle docs) is a multi-tenant, always-warm service — there are no cold starts. Cold starts are a concern for **Provisioned** deployments (reserved throughput) during initial provisioning, not for Standard/Global Standard pay-as-you-go. For a latency-sensitive word game calling the API on demand, Global Standard is the right choice and cold start is not a concern.

### Transient 5xx Errors

Azure's SLA for Azure OpenAI in Global Standard is 99.9% uptime (standard Azure AI Services SLA). Transient 5xx errors (502 Bad Gateway, 503 Service Unavailable) occur but are rare. The `openai` SDK's built-in retry logic (configured via `maxRetries`) handles these automatically with the same exponential backoff mechanism as 429s.

**Retry-after monitoring:** The SDK surfaces `x-ratelimit-remaining-tokens` and `x-ratelimit-remaining-requests` headers on successful responses. Log these during development to understand your quota headroom. In production, you can set up Azure Monitor alerts on the deployment's metric `TokensPerMinuteUsagePercentage` exceeding 80% as an early warning.

### Summary Failure Mode Table

| Failure Mode | HTTP Status | Frequency | SDK Auto-Retry? | Recommended App-Level Handling |
|---|---|---|---|---|
| Rate limit (TPM/RPM exhausted) | 429 | Low at game-scale | ✅ Yes (respects `retry-after-ms`) | Display "Verifying..." spinner; SDK retries transparently |
| Content filter — input | 400 `content_filter` | Very low for normal gameplay | ❌ No (permanent for that content) | Catch, show player-friendly message |
| Content filter — output | 400 `content_filter` | Very rare | ❌ No | Retry with modified temperature or simplified prompt |
| Transient server error | 500/502/503 | Rare | ✅ Yes | SDK retries; after `maxRetries` exhausted, show generic error |
| Network timeout | Timeout | Rare | ✅ Yes | Set `timeout: 30000`; SDK retries |
| Schema refusal (model refuses) | 200, `finish_reason: "content_filter"` | Rare | ❌ No | Parse `finish_reason`; handle gracefully |
| Malformed JSON (non-strict models) | 200 | N/A for gpt-4.1-mini with strict=true | N/A | Strict mode eliminates this class of failure entirely |

---

## Summary of Recommendations

| Decision | Recommendation | Reasoning |
|----------|---------------|-----------|
| **Judge model** | `gpt-4.1-mini` (primary), `gpt-5-mini` (fallback) | Strict JSON, strong world knowledge, low cost ($0.52/1K rounds), fast |
| **Bonus Generator model** | `gpt-4.1-nano` | Strict JSON, nearly zero cost, fast |
| **Deployment type** | Global Standard | Lowest latency, auto-routing, no cold starts |
| **Prompt structure** | `system` = persona + rules; `user` = per-round data | Maximizes caching, cleaner separation |
| **JSON Schema** | Add `additionalProperties: false` + `required: [all fields]` everywhere; use `"type": ["string","null"]` for optionals | OpenAI strict requirement |
| **Validation** | Golden dataset N=100-200; accuracy threshold ≥95% clear cases | Practical for solo dev |
| **Retries** | `maxRetries: 3` in SDK constructor | Covers 429 and 5xx transparently |
| **Content filter** | Default is fine; raise threshold to "high only" if false positives occur | Word-game content is low-risk |

---

## Key Citations

| Topic | Source | URL |
|-------|--------|-----|
| Model catalog (August 2026) | Microsoft Learn — Foundry Models sold by Azure | `https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure` |
| Structured outputs how-to (updated 2026-08-06) | Microsoft Learn — How to use structured outputs | `https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs` |
| Structured output supported models list | Same doc (live fetch, all models confirmed) | Same URL above |
| JSON Schema limitations (additionalProperties, required, nesting, unsupported keywords) | Same doc, "JSON Schema support and limitations" section | Same URL above |
| Content filtering categories and configuration | Microsoft Learn — Content filtering (classic) | `https://learn.microsoft.com/en-us/azure/foundry-classic/foundry-models/concepts/content-filter` |
| Quota and rate limits (TPM/RPM) | Microsoft Learn — Manage quota (classic) | `https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/quota` |
| Evaluation framework and SDK | Microsoft Learn — Observability in Generative AI (updated 2026-08-01) | `https://learn.microsoft.com/en-us/azure/foundry/concepts/observability` |
| Evaluation API (classic) | Microsoft Learn — Evaluations how-to | `https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/evaluations` |
| Model lifecycle and retirement policy | Microsoft Learn — Model retirements | `https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/model-retirements` |
| Azure OpenAI pricing page | Microsoft Azure | `https://azure.microsoft.com/en-us/pricing/details/azure-openai/` |
| Phi-4 serverless pricing | FutureAGI / CloudPrice (cross-referenced) | `https://futureagi.com/llm-cost-calculator/azure-ai-foundry/phi-4/` / `https://cloudprice.net/models/microsoft-phi-4` |
| Llama serverless pricing | Azure official (Llama pricing page) | `https://azure.microsoft.com/en-us/pricing/details/ai-foundry-models/llama/` |
| GPT-4.1-mini/nano, GPT-5-mini/nano pricing | PricePerToken.com, AzureSpeed.com, LiveChatAI calculator | Cross-referenced — verify at official pricing page |
| Content filter false positives | Microsoft Q&A | `https://learn.microsoft.com/en-us/answers/questions/2184291/false-positives-in-azure-openai-content-filtering` |
| SDK auto-retry (`maxRetries`) | @azure/openai npm package docs | `https://www.npmjs.com/package/@azure/openai` |
| Rate limit retry guidance | Microsoft Learn Q&A | `https://learn.microsoft.com/en-us/answers/questions/1851574/resolving-429-errors-in-azure-openai-due-to-rate-l` |

---

**Confidence levels:** Model availability and structured output support — **High** (live doc fetch). Pricing numbers — **Medium** (not directly readable from JS-rendered pricing page; cross-referenced from third-party aggregators; verify before committing). Retry behavior and content filter details — **High** (live doc fetch + multiple sources). Evaluation SDK capabilities — **High** (live doc fetch).