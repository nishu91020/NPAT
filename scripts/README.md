# scripts

## `deploy.ps1`

Builds and deploys to Azure Container Apps, then verifies the deployment is
actually serving.

```powershell
# Build the working tree and deploy it
.\scripts\deploy.ps1

# Roll back to an image already in the registry (no rebuild, ~40 seconds)
.\scripts\deploy.ps1 -Tag v20260808205540

# First-time setup: resource group, storage, environment, app, identity,
# role assignments, budget - then deploy
.\scripts\deploy.ps1 -Provision
```

Prerequisite: `az login`. Nothing else — the image is built in Azure, so Docker
is not needed locally.

### What it verifies

A deploy is not reported as successful until all four pass:

1. `/api/health` responds (retried, because the app scales to zero and the first
   request pays a cold start)
2. The SPA is served, checked by looking for the app root in the HTML
3. **A real round scores** — this exercises Foundry over managed identity end to
   end, and warns loudly if it comes back `heuristic`, which means the AI judge
   is unreachable even though the game still works
4. The daily challenge endpoint responds

### Gotchas it handles

These each cost time to discover by hand, so they are encoded rather than
remembered.

- **The az CLI crashes with `UnicodeEncodeError` while streaming ACR build
  logs** — it is a Python application printing a tick character to a cp1252
  console. `PYTHONIOENCODING=utf-8` mostly fixes it, but the script also treats
  a failed exit from `acr build` as unproven rather than fatal: **the cloud
  build usually succeeded anyway**. It polls the task status and checks the tag
  actually exists, which is the real verdict.
- **`az` is not always on PATH**, particularly in a shell opened before it was
  installed. The script falls back to the known install locations.
- **`-o json` cannot be passed through a PowerShell wrapper function** —
  PowerShell binds `-o` to its own common parameters and fails with "the
  parameter name 'o' is ambiguous". Output flags are appended to the argument
  array instead.
- **The containerapp extension prints a WARNING onto stdout**, ahead of the
  payload, which breaks `ConvertFrom-Json`. Output is trimmed to the first JSON
  token.
- **`az consumption budget create` rejects a resource-group scope.** The budget
  is created through `az rest` against the stable API version.

### Rollback

Every deploy prints its tag. Pass a previous one to `-Tag` and the build is
skipped entirely, so a rollback takes about 40 seconds. Container Apps also
keeps revisions, so traffic can be shifted from the portal instead.

### Configuration

Defaults match the live deployment and can be overridden per run:

| Parameter | Default |
|---|---|
| `-ResourceGroup` | `rg-lettersdaily` |
| `-Location` | `eastus2` |
| `-AppName` | `ca-lettersdaily` |
| `-MinReplicas` / `-MaxReplicas` | `0` / `5` |
| `-BudgetAmount` | `10` (USD per month) |

`-Provision` is idempotent: it reuses an existing storage account rather than
inventing a new globally-unique name, and skips role assignments that already
exist.
