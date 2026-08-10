# Map: Replace Gemini with a model on Microsoft Foundry

Label: `wayfinder:map`

## Destination

A **reviewed spec** for replacing the Gemini API with a model deployed on Microsoft Foundry
(formerly Azure AI Foundry) as the app's LLM provider. The map is done when every decision the
spec depends on is settled and the spec has been written for review — implementation is a
separate effort that follows.

## Notes

**Domain.** `server/referee/` and `server/bonus/` in this repo. Two LLM call sites, both already
behind ports (`Judge`, `BonusChallengeSource`), both taking an injected client. Swapping provider
means writing two new adapters — the ports themselves do not change.

**Skills to consult.** `microsoft-foundry` (provisioning, RBAC, quota, region, deployment,
evaluation) is installed in this environment and is the right tool for the `task` tickets.
`/grilling` and `/domain-modeling` for the decision tickets, `/prototype` for the adapter draft.

**Standing preferences for this effort.**
- Cost ceiling: must stay in "effectively free" territory. Assumed, not confirmed — see Assumptions.
- The heuristic judge stays. It is the degraded path and is provider-independent.
- Scoring rules never move into a provider adapter. Judges rule on words; the referee scores.

**Assumptions made while charting** (user was away; reverse any of these and the map shifts):
1. Destination is a spec, not an implementation.
2. The Function App migration is out of scope.
3. Gemini is fully removed, not kept as a second live provider.
4. Cost must fit free credits.
5. Azure account state unknown — Provision a Foundry resource and deploy the models assumes
   starting from no subscription. If one exists, that ticket shrinks.

**A draft spec exists early.** [spec.md](spec.md) was written ahead of the decision tickets, because
the user asked for "a spec first for me to review" and a map alone gave them nothing to react to. It
pre-fills every open decision with a research-backed recommendation, each marked 🟡 PROVISIONAL and
linked to its ticket. **Those tickets remain open** — a recommendation is not the user's decision,
and the grilling tickets still need the live exchange. When each is confirmed or corrected, resolve
the ticket and revise the spec section.

## Decisions so far

- [Which SDK and how to guarantee structured JSON](issues/01-research-sdk-structured-output.md) —
  Use the `openai` npm package against `https://<resource>.openai.azure.com/openai/v1/`, not
  `@azure/openai` (legacy companion). `response_format: { type: "json_schema", strict: true }` is
  supported, **but only on Azure OpenAI models** — open-weight models (Phi, Llama, Mistral,
  DeepSeek) cannot guarantee it. Strict mode requires `additionalProperties: false` on every object
  and every property in `required`; `maxLength`/`pattern` are unsupported, so length limits must
  stay in the prompt. No local emulator exists.
- [Which model, at what cost, with what failure modes](issues/02-research-model-cost-reliability.md) —
  `gpt-4.1-mini` recommended for the Judge, `gpt-4.1-nano` for the bonus generator. ~$0.52 per
  1,000 judge rounds; cost is not a real constraint at this scale. Global Standard deployment, no
  cold starts. **Content filtering is on by default and runs on input** — a new failure mode, since
  players type arbitrary words. The `openai` SDK auto-retries 429s and 5xx.

## Not yet specified

- **Observability of the new provider.** Token spend, latency, and quota headroom want watching once
  something real is deployed, but the shape depends on where the app ends up hosted — which is out
  of scope here. Revisit after Provision a Foundry resource and deploy the models.
- **Prompt tuning after first contact.** The existing prompts were written for Gemini. Whether they
  need real reworking (beyond the mechanical system/user split) can't be judged until the prototype
  has run against live output. Revisit after Draft the Azure adapter.
- **Retry and timeout tuning.** The SDK defaults are probably fine, but the right `maxRetries` and
  timeout depend on observed latency and the quota tier actually granted.
- **What happens to the `isRealtimeBonus` flag and the `judgedBy` values.** `judgedBy` is currently
  `'gemini' | 'heuristic'`. The new provider needs a name, and the daily-challenge response exposes
  `isRealtimeBonus`. Minor, but it touches shared types and the client.

## Out of scope

- **Converting `server.ts` to an Azure Function App** (`note.md`, line 2). A hosting change, not a
  provider change — different failure modes, independently valuable, and bundling it would make
  neither reviewable. Separate effort.
- **Making the game more engaging / UI-UX work** (`note.md`, lines 3-4). Unrelated to this
  destination.
- **Migrating the heuristic judge or the scoring rules.** They are provider-independent by design
  and this effort must not disturb them.
