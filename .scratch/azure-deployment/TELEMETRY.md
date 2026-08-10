# Telemetry — Application Insights

Resource `appi-lettersdaily`, workspace-based on the Log Analytics workspace the Container Apps
environment already created. Enabled by setting `APPLICATIONINSIGHTS_CONNECTION_STRING`; unset means
the app runs with a no-op and records nothing.

## What it answers, and why only this

Telemetry was deliberately scoped to the questions the deployment actually needs, rather than
"log everything and query it later" — which is how you end up paying to ingest logs nobody reads.

**The question that matters:** a rise in `judgedBy = heuristic` means Microsoft Foundry is failing
while the game still looks completely healthy, because `withFallback` degrades silently by design.
Without this, the app returns 200s and correct-looking scores while quietly not using the AI at all.

## How it is recorded

Domain facts are attached as attributes to the **request span the auto-instrumentation already
creates**, rather than emitted as separate events. They land as `customDimensions` on the request
telemetry, alongside its duration and success — so one query answers the question, and there is no
extra ingestion cost.

| Attribute | Meaning |
|---|---|
| `npat.judged_by` | `azure`, `heuristic`, or `gemini` from a legacy stored round |
| `npat.judge_duration_ms` | wall-clock judging time — the "Verifying Answers…" spinner |
| `npat.total_score` | round score |
| `npat.filtered_categories` | how many answers the content filter refused, usually 0 |
| `npat.daily_origin` | `memory`, `store` or `generated` — whether the shared store is working |
| `npat.daily_date` | which day was served |

Note the values arrive as **strings** in `customDimensions`; numeric ones need `toint()`.

## Queries

**Which judge is ruling, and how slow is it?** The one to alert on.

```kusto
requests
| where timestamp > ago(24h)
| extend judgedBy = tostring(customDimensions['npat.judged_by'])
| where judgedBy != ''
| summarize rounds = count(), avgJudgeMs = round(avg(toint(customDimensions['npat.judge_duration_ms']))) by judgedBy
```

**Is the daily challenge store working?** A collapse to `generated` across replicas means the store
is unreachable and players may be seeing different challenges.

```kusto
requests
| where timestamp > ago(24h)
| extend origin = tostring(customDimensions['npat.daily_origin'])
| where origin != ''
| summarize count() by origin
```

**Is the content filter rejecting real players?**

```kusto
requests
| where timestamp > ago(7d)
| extend filtered = toint(customDimensions['npat.filtered_categories'])
| where filtered > 0
| summarize count() by bin(timestamp, 1d)
```

**Judge latency distribution.**

```kusto
requests
| where name == 'POST /api/validate'
| summarize percentiles(duration, 50, 95, 99) by bin(timestamp, 1h)
```

## Verified in production — 2026-08-08

Requests auto-instrumented with route names, and all six custom dimensions arriving. A live sample:

| judgedBy | rounds | avg judge ms |
|---|---|---|
| azure | 3 | 3148 |
| heuristic | 1 | 2824 |

The single `heuristic` row was recorded during the deployment transition — **an unplanned
demonstration of the exact signal this exists for.** The API returned a normal 200 with a plausible
score; only telemetry showed the AI judge was not used.

Daily challenge origins in the same window: `store` 1, `memory` 2 — the shared store being read once
and then cached, as designed.

## Gotchas

- **`useAzureMonitor()` must run before anything else is imported.** The OpenTelemetry
  instrumentations patch `http` and `express` as they load, so anything imported earlier is never
  instrumented and its telemetry vanishes silently. `server/telemetry/init.ts` is imported on the
  **first line** of `server.ts`, and the built bundle was checked to confirm `useAzureMonitor`
  appears before `require("express")`. If instrumentation ever goes quiet, check that ordering first.
- **`init.ts` loads dotenv itself.** It runs before `server.ts` reaches its own `dotenv.config()`,
  so without this the connection string is invisible locally. dotenv does not override variables
  already set, so the real environment still wins in Azure.
- **The connection string is treated as ordinary configuration, not a secret.** It is write-only
  ingestion and grants no read access. This is a deliberate exception to the project's "no secrets in
  configuration" property, recorded here so it is not mistaken for an oversight.
- **No sampling.** Traffic is far below the 5 GB/month free allowance, and sampling would make rare
  events — the failures worth seeing — statistically invisible.

## Not done

- **No alert rule yet.** The obvious one: fire when the share of `judgedBy = heuristic` exceeds a
  threshold over an hour. The query above is the basis for it.
- **Browser telemetry.** Server-side only; the open questions are all server-side, and the browser
  SDK would add weight to the bundle and raise a consent question this game does not currently have.
