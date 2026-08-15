# Where can shared room state live on this deployment?

Type: research
Status: resolved

## Question

A room is mutable state that several players read and write within seconds of each other. The app
runs on Azure Container Apps with `minReplicas: 0` and `maxReplicas: 5`
([DEPLOYED.md](../../azure-deployment/DEPLOYED.md)), so an in-process `Map` is wrong twice over:
two players in one room can be served by different replicas, and an idle moment scales the app to
zero and erases every room.

This is the same class of bug the project already hit and fixed once — each replica generated its
own daily challenge until `DailyChallengeStore` made a shared store the source of truth.

Find, with citations:

- **The realistic options** for hot, shared, small state on Container Apps: Azure Cache for Redis
  (which tiers, what the cheapest one actually costs, and whether Entra ID / managed identity auth
  is supported), Azure Web PubSub (does it hold state or only fan out messages?), Cosmos DB
  serverless, Azure Table Storage, and the existing Blob storage account. For each: rough monthly
  cost at this scale, write latency, and whether it supports the atomic operations a room needs —
  "add a player if the room isn't full", "record this submission once", "first writer wins" (the
  `putIfAbsent` shape `DailyChallengeStore` already relies on).
- **Whether Container Apps can pin a room to one replica instead**: does it support session
  affinity / sticky sessions, how is it configured, what are its documented failure modes on
  revision changes and scale-in, and does it interact with `minReplicas: 0`?
- **What scale-to-zero does to a room.** Confirm the documented behaviour: with `minReplicas: 0`,
  what happens to in-flight connections and in-memory state when the app scales in, and does any
  scale rule keep a replica alive while connections are open (the KEDA HTTP/concurrency rules)?
- **Whether any of these can be authenticated with the existing system-assigned managed identity**,
  since this deployment holds no secrets or connection strings anywhere and that is a deliberate
  property worth keeping.
- **Whether an approach exists that costs nothing extra** — e.g. rooms held in the existing storage
  account — and what it would cost in latency and correctness (blob has no compare-and-swap without
  ETags; check whether ETag conditional writes cover the atomic operations above).

Answer for the general case, not for one assumed design: this ticket runs in parallel with
[What shape does a multiplayer round take?](01-round-shape.md) precisely so the product decision is
not made by whatever infrastructure was easiest.

The budget is $10/month with alerts at 80%, and the current app is close to free. An option that
triples the bill needs to say so plainly.

## Context

Findings land at [research/02-room-state-options.md](../research/02-room-state-options.md), written
by a `/research` subagent fired when this map was charted.

## Answer

**Full findings: [research/02-room-state-options.md](../research/02-room-state-options.md).** The
short version, all figures confirmed from the **Azure Retail Prices API** (a first-party
unauthenticated JSON endpoint — the pricing *pages* are JavaScript-rendered and return `$-`),
eastus2, 2026-08-11:

- **Redis does not fit the budget.** The smallest Azure Managed Redis SKU, B0 Balanced, is
  $0.016/hr = **$11.68/month** pay-as-you-go single-node — more than the entire $10/month budget,
  before the app itself. Only a **1-year committed reservation** ($7.58/month) fits, which is a
  commitment to a year of spend on a feature that has not shipped. Note also that the classic
  **Azure Cache for Redis is retiring 2028-09-30**, so it is not an option for new work either.
- **Web PubSub is not a store at all** — it is message fan-out, and its smallest paid unit is
  ~$49/month. It belongs to the transport question, not this one.
- **The recommendation is the storage account already deployed.** Blob first, Table a close second.
  Zero extra cost, no new resource, no new SDK, no new auth mechanism, and `blobStore.ts` already
  demonstrates every operation a room store needs — `putIfAbsent` via an `If-None-Match: '*'` ETag
  conditional write is in production today. The tradeoff is ~5–20 ms per operation and a
  client-side retry loop for compound updates like "add a player if the room isn't full".
  **Table Storage overtakes Blob if a room turns out to be several entities that must be updated
  atomically together** — its Entity Group Transactions do that within a partition and blob cannot
  — so this ranking should be re-read once the room data model is settled.
- **Session affinity is not a substitute.** It fails in four documented ways (replica unavailable,
  scale-in, revision change — which happens on *every* deploy — and scale-to-zero), so it cannot be
  the strategy on its own.
- **Scale-to-zero specifics:** the KEDA cool-down is 300 s, scale-down removes shutting replicas
  all at once, and a **TCP** scale rule keeps a replica alive while connections are open where an
  **HTTP** rule does not count WebSocket traffic after the upgrade.
- **Everything except legacy Redis supports managed-identity auth**, and Blob is the only option
  needing **no new role assignment** — the app already holds Storage Blob Data Contributor.

⚠️ One open thread carried into the spec: the Node.js token-refresh pattern for Redis under Entra
ID is not officially documented, and would need prototyping if Redis were ever chosen.
