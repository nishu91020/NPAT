# Deployed — 2026-08-08

**Live:** https://ca-lettersdaily.wonderfulwater-893e08f3.eastus2.azurecontainerapps.io

## What exists

| Resource | Name | Notes |
|---|---|---|
| Resource group | `rg-lettersdaily` | eastus2, same region as the Foundry resource |
| Container app | `ca-lettersdaily` | 0.5 vCPU / 1 GiB, min 0 / max 5 replicas |
| Environment | `cae-lettersdaily` | Consumption |
| Storage | `stlettersdaily90054` | daily challenge store; public blob access disabled, TLS 1.2 min |
| Registry | `ca9bc930aa10acr` | Basic, created automatically by `containerapp up` |
| Log Analytics | `workspace-rglettersdailyiFCS` | created with the environment |
| Budget | `budget-lettersdaily` | $10/month, alerts at 80% actual and 100% forecast |

## Identity — no secrets anywhere

System-assigned managed identity `42fcea0c-4bf2-4446-8b85-d017c9a69d61`, with three role
assignments, each scoped to exactly one resource:

| Role | Scope |
|---|---|
| Cognitive Services OpenAI User | the Foundry account |
| Storage Blob Data Contributor | the storage account |
| AcrPull | the registry |

No key, no connection string, no secret in configuration. `DefaultAzureCredential` resolves the
managed identity in Azure exactly as it resolves `az login` locally — the code is identical.

## Verified in production

- **Cold start from zero replicas: 760–960 ms.** Comfortable for a game that scales to zero.
- **AI judging works over managed identity** — `judgedBy=azure`, ~5.4 s for a judge call.
- **The target-letter guard holds in production**: `Tiger` scored 0 for the letter S despite being
  strongly on-theme for an India bonus.
- **Suggestions work**: a failed round returned Kevin, Kyoto, Koi and Kayak.
- **The daily challenge persisted to blob storage**, written by the app itself:
  `daily-challenges/2026-08-08.json`.
- **The scale-out fix is proven.** Scaled to 3 replicas, then requested a *fresh* date 12 times:
  **1 distinct challenge**. Without the shared store that would have been up to 3. Returned to
  `minReplicas: 0` afterwards.

## Deployment gotchas hit

- **`az containerapp up` crashed** with `UnicodeEncodeError: 'charmap' codec can't encode '\u2713'`
  — a CLI bug printing a tick to a cp1252 Windows console while streaming build logs. **The cloud
  build succeeded regardless**; the app was then created explicitly with `containerapp create`
  against the built image. Prefer `az acr build` + `containerapp create/update` on Windows.
- **`az consumption budget create` rejects resource-group scope** ("use filter interface with
  2019-05-01-preview"). Created via `az rest` against the 2021-10-01 API instead.
- **Listing blobs needs a data-plane role for *you*, not just the app.** The app had
  Storage Blob Data Contributor; my own account needed Storage Blob Data Reader before
  `--auth-mode login` would list anything.

## Redeploying

```powershell
$AZ = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
$TAG = "v$(Get-Date -Format yyyyMMddHHmmss)"

& $AZ acr build -r ca9bc930aa10acr -t "ca-lettersdaily:$TAG" .
& $AZ containerapp update -n ca-lettersdaily -g rg-lettersdaily `
    --image "ca9bc930aa10acr.azurecr.io/ca-lettersdaily:$TAG"
```

Roll back by pointing `--image` at a previous tag, or shift traffic to an earlier revision.

## Not done yet

- **Application Insights.** Log judge latency and `judgedBy` — a rise in `heuristic` means Foundry
  is failing while the game still looks healthy, which is otherwise invisible.
- **GitHub Actions with OIDC**, so deploys do not depend on a local `az login`.
- **The scheduled precompute job** (plan option D). Now an optimisation rather than a correctness
  fix: it would take the ~5 s generation off the first request of each day.
- **The registry is the largest fixed cost** (~$5/month Basic) — more than the app itself, which
  should sit inside the Container Apps free grant. Worth revisiting.
