# Spec — Replace Gemini with a model on Microsoft Foundry

**Status: DRAFT FOR REVIEW.** Decisions marked 🟡 **PROVISIONAL** are my recommendation, not your
decision — I drafted them from research rather than from a conversation with you, so that you have
something concrete to react to. Each links the ticket where it properly belongs. Correct any of
them and I'll revise; the surrounding spec mostly survives either way.

Map: [map.md](map.md) · Research: [01](research/01-sdk-and-structured-output.md) ·
[02](research/02-model-cost-reliability.md)

---

## 1. What this changes

The app calls an LLM in exactly two places. Both already sit behind ports and take an injected
client, so this migration writes two new adapters and deletes two old ones. **No interface changes.**

| | Today | After |
|---|---|---|
| Judge | `createGeminiJudge(ai)` → `Judge` | `createAzureJudge(client)` → `Judge` |
| Bonus | `createGeminiBonusSource(ai)` → `BonusChallengeSource` | `createAzureBonusSource(client)` → `BonusChallengeSource` |
| SDK | `@google/genai` | `openai` + `@azure/identity` |
| Client built in | `server.ts#createGeminiClient` | `server.ts#createAzureClient` |

### Explicitly unchanged

- The `Judge` and `BonusChallengeSource` ports.
- `server/referee/scoring.ts` — scoring stays out of adapters. Judges rule on words; the referee
  scores. This is what makes the swap safe.
- `heuristicJudge` — provider-independent, still the degraded path.
- `withFallback` / `withBonusFallback` composition.
- All 48 existing tests, which run against ports and fakes and never touch a network.

---

## 2. Model and deployment

🟡 **PROVISIONAL** — [Choose the models and how many deployments](issues/03-choose-models-and-deployments.md)

| | Recommendation | Why |
|---|---|---|
| Judge | `gpt-4.1-mini` | Needs world knowledge — that *Nilgai* is an animal, *Samosa* is Indian. Strict structured output, fast, ~$0.52/1,000 rounds. |
| Bonus generator | `gpt-4.1-nano` | Creative, not knowledge-dense, runs ~once/day behind the per-date cache. Noise-floor cost. |
| Deployment type | Global Standard | No cold starts, widest availability, pay-as-you-go. |
| Fallback model | `gpt-5-mini` | If quota or region blocks the primary. |

**Open sub-decision:** one deployment or two. Two matches each call's needs; one is less to
provision and configure, and the bonus generator is so infrequent that sharing `gpt-4.1-mini` costs
almost nothing. I lean **two**, because they already differ in temperature and the config cost is
one extra env var.

> ⚠️ **Open-weight models are ruled out.** Phi, Llama, Mistral and DeepSeek are cheaper or
> comparable, but they cannot guarantee strict structured output on this endpoint surface. A
> malformed response while the player watches the "Verifying Answers…" spinner is precisely the
> failure class we're buying strict mode to eliminate.

> ⚠️ **Prices unverified.** Azure's pricing page renders values via JavaScript and returned `$-` for
> every model. Figures here come from secondary sources and must be confirmed in the Azure pricing
> calculator before anyone relies on them.

---

## 3. SDK and client construction

Use the **`openai` npm package**, not `@azure/openai` (now a legacy companion) and not
`@azure/ai-projects` (Foundry-native features we don't need).

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: `https://${resourceName}.openai.azure.com/openai/v1/`,
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  maxRetries: 3,
});
```

The `/openai/v1/` route is stable and takes **no `api-version` query parameter** — a break from the
older deployment-scoped path.

**The `model` argument is the *deployment name*, not the model name.** This is the single easiest
thing to get wrong, and it makes the deployment name configuration rather than code.

---

## 4. Authentication

🟡 **PROVISIONAL** — [Decide the authentication strategy](issues/05-auth-strategy.md)

**Recommendation: API key now, Entra ID when hosting is settled.**

Microsoft recommends Entra ID (`DefaultAzureCredential`), and it's clearly better — no stored
secret, automatic from `az login` locally and from a managed identity in Azure. But its real payoff
is managed identity at the hosting layer, and hosting is out of scope for this map. An API key
mirrors today's `GEMINI_API_KEY` exactly, so it's the smaller change and doesn't pre-commit the
hosting decision.

If you'd rather go straight to Entra ID, the scope is `https://ai.azure.com/.default` — **not** the
older `https://cognitiveservices.azure.com/.default`, which is a documented source of 401s — and the
identity needs the *Cognitive Services OpenAI User* role.

---

## 5. Prompt restructuring

Gemini takes one `contents` string; OpenAI-style takes a messages array. The fixed persona and rules
become `system`, the per-round data becomes `user`. This reads better **and** makes the stable
prefix cacheable, cutting input cost ~75%.

```ts
messages: [
  { role: 'system', content: JUDGE_SYSTEM_PROMPT },  // persona + rules, fixed
  { role: 'user', content: renderRound(request) },   // letter, answers, bonus rule
]
```

The `system` prompt keeps the existing evaluation rules verbatim, including
`Do not assign points. Scoring is applied separately.`

⚠️ **Length limits must stay in the prompt.** Strict mode does not support `maxLength`, so
"feedback max 10 words" and the bonus generator's "title max 25 characters" remain instructions the
model may disobey. The bonus adapter already defends against this at parse time; the judge's
feedback is cosmetic, so overrun is tolerable.

---

## 6. Strict JSON schemas

Both schemas need `additionalProperties: false` on **every** object and every property in
`required`. Our shapes are otherwise already compatible — everything is required today, nesting is
2 deep against a limit of 5.

### Judge

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["categories", "overallFeedback", "bonusChallengeMet"],
  "properties": {
    "categories": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "place", "animal", "thing"],
      "properties": {
        "name":   { "$ref": "#/$defs/judgement" },
        "place":  { "$ref": "#/$defs/judgement" },
        "animal": { "$ref": "#/$defs/judgement" },
        "thing":  { "$ref": "#/$defs/judgement" }
      }
    },
    "overallFeedback":   { "type": "string" },
    "bonusChallengeMet": { "type": "boolean" }
  },
  "$defs": {
    "judgement": {
      "type": "object",
      "additionalProperties": false,
      "required": ["valid", "bonusMatched", "feedback"],
      "properties": {
        "valid":        { "type": "boolean" },
        "bonusMatched": { "type": "boolean" },
        "feedback":     { "type": "string" }
      }
    }
  }
}
```

`points` remains absent by design — the referee derives it, so the model cannot invent a score.
*(Verify `$defs`/`$ref` support in strict mode during the prototype; inline the four copies if it
misbehaves.)*

### Bonus challenge

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "title", "description", "icon", "ruleHint"],
  "properties": {
    "id":          { "type": "string" },
    "title":       { "type": "string" },
    "description": { "type": "string" },
    "icon":        { "type": "string",
                     "enum": ["Sparkles","Flag","Utensils","Globe","TreePine","Layers","Award"] },
    "ruleHint":    { "type": "string" }
  }
}
```

The enum stays sourced from `RENDERABLE_ICONS`, and the runtime clamp stays regardless — the UI can
only render those seven.

---

## 7. Configuration

🟡 **PROVISIONAL** — [Decide the configuration shape and how Gemini is retired](issues/09-config-and-gemini-retirement.md)

| Variable | Purpose |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | Key (omitted if Entra ID is chosen) |
| `AZURE_OPENAI_JUDGE_DEPLOYMENT` | Deployment name for the judge |
| `AZURE_OPENAI_BONUS_DEPLOYMENT` | Deployment name for the bonus generator |

**Configuration is now multi-part, which changes the "unconfigured" story.** Today a missing
`GEMINI_API_KEY` silently means heuristic-only, which is fine for one variable. With four, a
*partial* config is possible and almost always a mistake.

**Recommendation:** treat all-absent as "not configured" (heuristic-only, as today), but treat
*partial* config as a **fatal startup error**. Silently degrading on a typo'd variable is how a
production app quietly stops using the AI it's paying for.

---

## 8. Failure modes

| Mode | Status | Retry? | Handling |
|---|---|---|---|
| Rate limit | 429 | SDK auto | Transparent |
| Transient server | 5xx | SDK auto | Transparent, then `withFallback` → heuristic |
| **Content filter** | 400 `content_filter` | **Never** | See below |
| Model refusal | 200 + `finish_reason` | No | Treat as failure → heuristic |
| Malformed JSON | — | — | Eliminated by strict mode |

### Content filtering is the genuinely new risk

🟡 **PROVISIONAL** — [Decide how content-filter rejections behave](issues/06-content-filter-handling.md)

Azure filters **input as well as output**, by default. Gemini as configured here does not surface
this. **This app feeds player-typed words straight into a prompt**, so it will be hit eventually —
deliberately, by players testing the boundaries.

- It is permanent for that content. It must **not** be retried, and must not be laundered into a
  scored round by falling through to the heuristic.
- False positives are plausible: single-word answers give the filter little context, and non-English
  words carry more risk. This game explicitly encourages Indian/South Asian answers.

**Recommendation:** catch `content_filter` distinctly from transient failure. Score that *one*
category 0 with player-facing feedback ("we couldn't check that one"), and let the other three
categories score normally. Failing the whole round because one entry tripped the filter punishes
three valid answers. Consider raising thresholds to "high only" if false positives appear.

There's an upside worth naming: the game currently has **no** profanity handling at all, and the
input filter provides it free.

---

## 9. Retiring Gemini

🟡 **PROVISIONAL** — assumed full replacement.

Delete `geminiJudge.ts`, `geminiSource.ts` and their tests; drop `@google/genai`; remove
`GEMINI_API_KEY`. Two live AI providers means two sets of keys, costs and prompt variants, and
`heuristicJudge` already covers degradation.

⚠️ **`judgedBy` needs a decision.** It is `'gemini' | 'heuristic'` today, it is **persisted inside
saved rounds in `localStorage`**, and the UI keys the "Gemini AI Referee" badge off it. Players'
stored history will carry `'gemini'` forever. Options: add `'azure'` and keep `'gemini'` as a legacy
value the badge renders generically, or migrate stored results. I lean **keep the legacy value** —
it's honest about how that round was actually judged.

---

## 10. Testing

Existing tests run against ports with fake clients and don't touch the network — that pattern ports
directly. `geminiJudge.test.ts` becomes `azureJudge.test.ts` with a fake `openai` client, keeping
the same cases: well-formed parse, missing category, unparseable output, boolean coercion. Add one
for a `content_filter` 400.

🟡 **PROVISIONAL** — [Decide how we prove the new judge is good enough](issues/08-quality-validation-approach.md).
Recommendation: a golden set of ~100 answer-sets diffed between providers before cutover, ≥95%
agreement on clear-cut cases. For a hobby game this may be more rigour than you want — spot-checking
20 cases is a defensible alternative.

---

## 11. Implementation plan

Once decisions are confirmed, roughly:

1. Provision resource + deployment(s), set a budget alert — [ticket 04](issues/04-provision-foundry-resource.md)
2. `npm i openai` (+ `@azure/identity` if Entra ID); remove `@google/genai`
3. `server/referee/azureJudge.ts` + tests
4. `server/bonus/azureSource.ts` + tests
5. Rewire `server.ts` client construction and config validation
6. Content-filter handling per §8
7. Quality diff per §10
8. Delete Gemini adapters; update `.github/copilot-instructions.md`

The seam means steps 3–5 are additive — both providers can coexist during the diff, then the old one
is deleted.

---

## 12. Open decisions

| # | Decision | My lean |
|---|---|---|
| [03](issues/03-choose-models-and-deployments.md) | Models; one deployment or two | `gpt-4.1-mini` + `gpt-4.1-nano`, two |
| [05](issues/05-auth-strategy.md) | API key vs Entra ID | Key now, Entra ID with hosting |
| [06](issues/06-content-filter-handling.md) | Content-filter UX | Fail one category, not the round |
| [08](issues/08-quality-validation-approach.md) | Quality bar | ~100-case diff, ≥95% |
| [09](issues/09-config-and-gemini-retirement.md) | Config + `judgedBy` legacy | Fatal on partial config; keep `'gemini'` |

Plus the charting assumptions on [map.md](map.md): spec-not-implementation, Function App out of
scope, full Gemini removal, free-tier budget, no existing subscription.
