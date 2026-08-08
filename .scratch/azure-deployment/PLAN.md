# Deployment plan — Letters Daily on Azure

Target: scalable, secure, reliable, cost-efficient. Assessed against the Azure Well-Architected
Framework. Written 2026-08-08.

---

## 1. What we are deploying

| | |
|---|---|
| Frontend | React 19 SPA, built to static files by Vite |
| Backend | Express, 4 routes, one of which calls Microsoft Foundry |
| State | **None persisted.** Player stats live in the browser's `localStorage` |
| Secrets | **None.** Auth to Foundry is Entra ID via `DefaultAzureCredential` |
| External dependency | Microsoft Foundry, `gpt-4.1-mini` deployment |

Two properties make this cheap and simple to host: there is **no database**, and there are **no
secrets to manage**. Both are already true today — the Entra ID decision made during the migration
pays off directly here.

---

## 2. Recommended architecture

```
                    ┌──────────────────────────────────────────┐
   Player ─────────▶│  Azure Container Apps  (Consumption)      │
                    │  scales 0 → N                             │
                    │                                           │
                    │   ├── serves the SPA (static files)       │
                    │   └── /api/*  Express                     │
                    └───────────────┬───────────────────────────┘
                                    │ system-assigned managed identity
                                    │ (no secret, no key)
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │  Microsoft Foundry — gpt-4.1-mini        │
                    └──────────────────────────────────────────┘

                    ┌──────────────────────────────────────────┐
                    │  Application Insights  ◀── telemetry     │
                    └──────────────────────────────────────────┘
```

**One container app serving both the SPA and the API.** The app already does exactly this in
production mode (`express.static` plus an SPA fallback), so this needs no change to the serving
model. One deployable, one identity, one log stream — WAF **RE:01, simplicity and efficiency**.

### Why Container Apps

- **Scales to zero.** You are not billed usage charges while it is scaled to zero, and the
  Consumption plan includes a monthly free grant per subscription of **180,000 vCPU-seconds,
  360,000 GiB-seconds and 2 million HTTP requests**. A hobby word game will very likely sit inside
  that grant entirely.
- **Managed identity needs no code change.** `DefaultAzureCredential` finds the managed identity
  automatically when it runs in Azure. The same code path that uses your `az login` locally uses the
  container's identity in Azure.
- **HTTP scaling is built in** via KEDA rules on concurrent requests.
- `az containerapp up` **builds the image in the cloud**, so no local Docker is required.

### Alternatives considered

| Option | Why not |
|---|---|
| **App Service (B1)** | Always-on, roughly $13/month whether anyone plays or not. No scale to zero. Sensible if you later want deployment slots, but a poor fit for spiky hobby traffic. |
| **Static Web Apps + linked backend** | The Free tier only supports *managed* Functions; linking an existing container app or web app needs the **Standard** tier. Adds a second deployable and a CORS surface for a game whose static payload is 250 KB. Revisit if you want a global CDN and free custom-domain SSL. |
| **Azure Functions** | Would mean rewriting working Express routes into a different programming model, for a workload that is already one small correct server. Fails RE:01. |
| **AKS** | Wildly disproportionate. |

**Verdict:** Container Apps, Consumption plan, single region.

---

## 3. Blocking refactors

These must be done before the app can run in a container at all.

| # | Change | Why |
|---|---|---|
| 1 | **Read `PORT` from the environment.** `server.ts` hardcodes `const PORT = 3000`. | Container Apps injects the port. Hardcoding it means the ingress probe never succeeds and the revision never goes live. One line. |
| 2 | **Handle `SIGTERM`.** The server never closes gracefully. | On scale-in or a new revision the platform sends SIGTERM. Without a graceful close, in-flight rounds are dropped — a player loses a submitted answer. |
| 3 | **Add a `Dockerfile` and `.dockerignore`.** | Explicit and reproducible. Also keeps `node_modules`, `.env` and `.git` out of the build context — `.env` reaching an image would undo the "no secrets" property. |
| 4 | **Pin the Node version** via `engines`. | The build warns `EBADENGINE` on Node 22.11 because `@vitejs/plugin-react` wants `>=22.12`. Pin a version that satisfies it rather than shipping an unpinned image. |

---

## 4. The scaling correctness problem

**This is the one real architectural issue, and it is not obvious.**

`cachedPerDate` in `server/bonus/types.ts` holds the day's AI-generated bonus challenge in a
**`new Map()` — in process memory**. That is correct for one process, and wrong the moment there is
more than one.

With N replicas, each replica generates and caches its **own** daily challenge. Two players hitting
different replicas see different challenges on the same day, and a single player can watch the
challenge change on refresh as they are load-balanced around.

That is precisely the bug fixed earlier in this project. **Scaling out reintroduces it.**

### Options

| | Approach | Cost | Verdict |
|---|---|---|---|
| **A** | Pin `maxReplicas: 1` | free | Correct, but throws away the scalability you asked for. Fine as a stopgap. |
| **B** | Azure Cache for Redis as the shared cache | ~$16/month min | Correct, but the most expensive component in the system would exist to cache one small object a day. |
| **C** | **Blob Storage as source of truth, memory as a read-through cache** | pennies | Replicas converge on one value; memory keeps it fast. |
| **D** | **Scheduled job precomputes tomorrow's challenge into Blob Storage** | pennies | Best. Also removes the AI call from the request path entirely. |
| **E** | Make the daily challenge deterministic again (AI for practice only) | free | Zero infrastructure. Loses the AI-authored daily challenge. |

**DECIDED: C (blob store with read-through), implemented 2026-08-08.** Azurite is the local\nsubstitute, so the store is tested without touching the cloud. D (the scheduled precompute job)\nremains a worthwhile follow-up — it would additionally take the 3-5s model call off the request\npath — but C alone makes scaling correct, which was the blocking problem.

A Container Apps **scheduled job** (cron) runs once a day, generates tomorrow's challenge and writes
it to a blob. The web app reads that blob and caches it in memory. Consequences worth having:

- Every replica, and therefore every player, sees the same challenge. Correct by construction.
- The daily path **never waits on the model** — no 3–5 second generation on someone's first request
  of the day.
- Generation happens once per day globally rather than once per replica per day.
- If the job fails, the app still falls back to the deterministic date-hashed challenge, which is
  already implemented and tested.

**If you would rather add no infrastructure at all, take E.** It is honest and free; you lose only
the AI-authored daily twist, and practice mode keeps its AI challenges.

---

## 5. Security

The strong position here is already banked: **there are no secrets to leak.**

| Control | Action |
|---|---|
| **Identity** | Enable a **system-assigned managed identity** on the container app. Assign it **Cognitive Services OpenAI User** on the Foundry resource — the minimum role that permits inference. Not a contributor role. Assign it **Storage Blob Data Contributor** on the storage account for the daily challenge store. |
| **Kill key auth entirely** | Set `disableLocalAuth` on the Foundry resource so API keys cannot be used even if one is later created. Entra becomes the only way in. |
| **Ingress** | External ingress, HTTPS only. Container Apps terminates TLS and provides a certificate on the default domain. |
| **No secrets in the image** | `.dockerignore` must exclude `.env`. Verified: `.env` has never been tracked in git. |
| **Content filtering** | Already handled in code. Azure filters input by default and the app scores only the offending category zero rather than failing the whole round. |
| **Threat surface** | The API takes JSON and returns JSON. No file upload, no SQL, no user accounts. `express.json()` should get an explicit size limit. |

---

## 6. Reliability

Set targets before choosing redundancy — WAF **RE:04**.

**Proposed target: 99% monthly, single region, best-effort.** This is a free hobby game with no
revenue and no SLA. Multi-region active-active would multiply cost and complexity for a game whose
worst failure mode is "someone plays tomorrow instead". A deliberate tradeoff, stated rather than
assumed.

| Concern | Position |
|---|---|
| **Health probes** | `/api/health` already exists. Wire it as the liveness and readiness probe. |
| **Graceful shutdown** | Refactor 2 above. |
| **Foundry failure** | Already handled: `withFallback` degrades to the heuristic judge, so the game stays playable if the model is down. Genuine self-preservation (**RE:07**), already tested. |
| **Transient faults** | The SDK retries 429 and 5xx with backoff, `maxRetries: 3`. |
| **Availability zones** | Container Apps Consumption spreads replicas across zones where the region supports it, at no cost. Choose a region that has zones. |
| **Data loss** | There is no server-side data. Player stats are in `localStorage` — losing the app loses nothing. It also means a player switching browsers loses their streak, which is a product decision, not a reliability one. |

### The real scaling ceiling is Foundry, not the container

Adding replicas will not help if the model deployment is rate-limited — quota is measured in tokens
and requests per minute against the *deployment*, not the app. Under real load the container scales
out happily and then every replica collects 429s. Watch the deployment's TPM utilisation before
concluding the app needs more replicas.

---

## 7. Cost

| Component | Expected monthly |
|---|---|
| Container Apps (Consumption) | **$0** while inside the free grant of 180k vCPU-s / 360k GiB-s / 2M requests |
| Blob Storage (option D) | pennies — one small object per day |
| Container Apps Job (option D) | negligible — a few seconds of compute per day |
| Application Insights | free within the 5 GB/month ingestion allowance at this volume |
| Container Registry (Basic) | ~$5/month — **avoidable**, see below |
| Microsoft Foundry | ~$0.52 per 1,000 judged rounds on `gpt-4.1-mini` |

**The registry is the one thing likely to cost more than the app.** At this scale `az containerapp
up` can build and deploy without you maintaining a Basic ACR; if you do create one, it becomes the
single largest fixed line item. Worth a deliberate decision rather than an accident.

**Guardrails:**
- Set a **budget alert** on the resource group. Non-negotiable — the app is public and the model is
  metered per token.
- Keep `minReplicas: 0` so idle costs nothing.
- Set a sane `maxReplicas` (say 5). Without a ceiling, a traffic spike or a crawler converts
  directly into a Foundry bill.

---

## 8. Operations

| | |
|---|---|
| **Deploy** | `az containerapp up` from source to start. Move to GitHub Actions with OIDC federated credentials once stable — no publish profile secret in the repo. |
| **Observability** | Application Insights. Log the two things that actually matter: judge **latency** (observed 3–5 s) and `judgedBy`, because a rise in `heuristic` means Foundry is failing while the game still looks healthy. That degradation is invisible without it. |
| **Configuration** | The three `AZURE_OPENAI_*` variables become container app environment variables. Not secrets — an endpoint and two deployment names. Partial config already fails fast at startup, which surfaces a misconfigured revision immediately. |
| **Rollback** | Container Apps keeps revisions. Roll back by shifting traffic to the previous revision. |

---

## 9. Order of work

1. ~~**Blocking refactors** — PORT, SIGTERM, Dockerfile, `.dockerignore`, engines~~ **DONE**
2. ~~**Decide the daily-challenge approach**~~ **DONE** — blob store with read-through cache,
   Azurite locally. Verified with two server processes sharing one store returning the identical
   challenge.
3. Provision: Container Apps environment, app, managed identity, role assignment, budget alert
4. First deploy with `az containerapp up`; verify `/api/health` and one live round
5. Add Application Insights and the two log fields above
6. Implement the chosen option from step 2
7. Move deployment into GitHub Actions with OIDC

Steps 1 and 3–4 get you a working, secure, scale-to-zero deployment. Step 2 is what makes it correct
under load.
