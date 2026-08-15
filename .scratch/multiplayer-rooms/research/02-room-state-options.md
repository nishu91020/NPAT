# Where can shared room state live? — Research findings

Type: research  
Status: complete  
Ticket: [02-research-room-state.md](../issues/02-research-room-state.md)  
Research date: 2026-08-11  
Docs freshness: All primary sources fetched 2026-08-11; Microsoft Learn pages last updated as cited.

---

## Summary

A room is mutable, hot, multi-writer state that lives for minutes and must be visible across all
replicas of the Container App. This is the same class of problem as the daily-challenge race that
`DailyChallengeStore` already solved — an in-process `Map` is wrong for two independent reasons:
players can land on different replicas, and an idle moment scales the whole app to zero and erases
every room. Five external options are evaluated below (Azure Managed Redis, Azure Web PubSub,
Cosmos DB Serverless, Azure Table Storage, Blob Storage), along with session affinity as a
partial mitigation and the scale-to-zero behaviour that removes that mitigation. The clear zero-
extra-cost option is the existing storage account; whether it is fast enough depends on the latency
the chosen multiplayer design can tolerate, and that question belongs to a sibling ticket.

**Headline: the two cheap options are the ones already deployed.** Confirmed from the Azure Retail
Prices API (2026-08-11, eastus2): the smallest Azure Managed Redis SKU (B0 Balanced) is
**$11.68/month** pay-as-you-go — over the whole $10/month budget on its own — and the smallest paid
Azure Web PubSub unit is **~$49/month**. Blob and Table Storage in the **existing** storage account
cost effectively nothing extra, need no new resource, and reuse the managed identity and the
`putIfAbsent` ETag pattern `blobStore.ts` already runs in production. Ranked recommendation at the
end; the tradeoff is latency (~5–20 ms per operation) and a retry loop for compound updates.

**Critical note on Azure Cache for Redis retirement:** The classic Azure Cache for Redis service
(Basic/Standard/Premium tiers) has been officially announced for retirement on **September 30,
2028**. Microsoft explicitly recommends migrating to **Azure Managed Redis** now. Any new
deployment should use Azure Managed Redis, not Azure Cache for Redis.

---

## Option 1 — Azure Managed Redis (recommended Redis path)

### What it is

Azure Managed Redis is the successor to Azure Cache for Redis. It is built on Redis Enterprise
software (not the OSS fork), is clustered by default, and supports all Redis data structures and
atomic commands. It is the only Redis offering that Microsoft currently recommends for new
workloads.

**Source:** Azure Cache for Redis Retirement FAQ, updated 2026-03-26:
<https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq>

### Tiers and confirmed pricing — eastus2

All prices below are from the **Azure Retail Prices API** (primary, non-JS source, no auth
required), queried directly at:
`https://prices.azure.com/api/retail/prices?$filter=armRegionName eq 'eastus2' and contains(productName,'Managed Redis')`
Fetched: 2026-08-11. `armRegionName: eastus2`, `currencyCode: USD`.

**Smallest production-relevant SKUs — Balanced tier (productName: "Azure Managed Redis - Balanced"):**

| skuName | meterName | retailPrice | unitOfMeasure | Monthly PAYG (× 730 h) | effectiveStartDate | skuId |
|---------|-----------|-------------|---------------|------------------------|--------------------|-------|
| **B0** | B0 Cache Instance | **$0.016/hr** | 1 Hour | **$11.68/month** | 2026-01-01 | DZH318Z08MJT/003W |
| B1 | B1 Cache Instance | $0.032/hr | 1 Hour | $23.36/month | 2026-01-01 | DZH318Z08MJT/0046 |
| B3 | B3 Cache Instance | $0.065/hr | 1 Hour | $47.45/month | 2026-01-01 | DZH318Z08MJT/003V |
| B5 | B5 Cache Instance | $0.156/hr | 1 Hour | $113.88/month | 2026-01-01 | DZH318Z08MJT/0044 |

**Reservations for B0 (from same API query):**

| Type | retailPrice | Derived monthly |
|------|-------------|-----------------|
| 1-year reserved | $91.00/year | **$7.58/month** |
| 3-year reserved | $189.00/3yr | $5.25/month |

> **Important:** The API prices above are for a **single-node (non-HA) instance**. A two-node
> high-availability B0 would cost approximately **$23.36/month** PAYG (double the single-node
> rate). Azure Managed Redis pricing page lists PAYG One Node (Non-High Availability) and PAYG
> Two Node (High Availability) as separate columns; the API `Consumption` type reflects
> the per-node hourly rate.

### Budget verdict for this deployment

| Scenario | Monthly cost | Fits $10 budget? |
|----------|-------------|-----------------|
| B0 PAYG, single-node (non-HA) | **$11.68/month** | ❌ No — $1.68 over the hard ceiling |
| B0 1-year reserved, single-node | **$7.58/month** | ✅ Yes — but requires a committed annual purchase |
| B0 PAYG, two-node HA | ~$23.36/month | ❌ No |
| B1 PAYG, single-node | $23.36/month | ❌ No |

**Redis does not fit within a strict $10/month PAYG budget.** The cheapest option that fits is
the 1-year reserved B0 at $7.58/month — but "commit to a year of Redis" is a different
decision from "pay as you go." If a committed reservation is acceptable, Redis becomes
budget-compatible. If PAYG is required, Redis exceeds the budget by $1.68/month at the smallest
SKU.

The 1-year reserved B0 also has no published SLA data in the API response. The Azure Managed
Redis overview states "Up to 99.999% availability" for all tiers; whether single-node (non-HA)
carries a reduced SLA should be confirmed before committing.

### Write latency

Sub-millisecond to the Redis node; practical single-operation latency from an eastus2 Container
App in the same region is typically 1–3 ms. Fastest option of all five evaluated.

### Atomic operations for room state

| Operation | Redis mechanism |
|-----------|----------------|
| "Add player only if room not full" | Lua script (atomic read + conditional write, single server-side execution) or `WATCH`/`MULTI`/`EXEC` optimistic transaction with client retry |
| "Record submission exactly once / first writer wins" | `SET key value NX` (Set if Not eXists) |
| "First writer wins on room entity" | `SET key value NX` or `SETNX` |

Lua scripts are the most reliable path for compound atomic operations because `WATCH`/`MULTI`/`EXEC`
can abort under contention and requires a client retry loop.

### Microsoft Entra ID / managed identity authentication

**Yes — supported on all Azure Managed Redis tiers.** Confirmed from the pricing page feature
matrix: "Microsoft EntraID Auth: Yes" for Memory Optimized, Balanced, Compute Optimized, and
Flash Optimized tiers.

Source: <https://azure.microsoft.com/en-us/pricing/details/managed-redis/>
Entra authentication docs: <https://learn.microsoft.com/en-us/azure/redis/entra-for-authentication>

The authentication flow requires acquiring an Entra token for scope
`https://redis.azure.com/.default` using `DefaultAzureCredential`, supplying the managed identity
object ID as the Redis `USER`, and the token as the Redis `PASSWORD`. The client must
periodically re-acquire the token and re-issue `AUTH` before expiry. No static connection string;
no secrets required.

**Additional implementation note:** The .NET path uses the `Microsoft.Azure.StackExchangeRedis`
package to wrap token refresh automatically. There is no official Node.js equivalent; the
application must implement the token-refresh loop manually. This is a non-trivial operational
concern that does not exist for any of the Storage-based options.

### Cross-check: Legacy Azure Cache for Redis Basic C0 (retiring 2028)

For reference, the legacy Basic C0 (250 MB, no SLA, retiring September 30, 2028) is confirmed
from the same API at:

```
skuName: C0 | meterName: C0 Cache | retailPrice: $0.022/hr | productName: Azure Redis Cache Basic
armSkuName: Azure_Redis_Cache_Basic_C0_Cache | effectiveStartDate: 2014-11-01
```

Monthly: $0.022 × 730 = **$16.06/month** — more expensive than the B0, with no SLA, and
retiring September 30, 2028. **Do not use for new work.**

## Option 2 — Azure Cache for Redis (legacy — do not use for new work)

Documented here because existing docs and tutorials reference it heavily, but:

> **Azure Cache for Redis (Basic, Standard, Premium) is retired September 30, 2028.**
> Microsoft explicitly recommends migrating to Azure Managed Redis.
>
> Source: <https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq>

The Basic C0 (250 MB) was priced at approximately **$16/month** and the Standard C0 at
approximately **$23/month** as of 2025 (secondary source, primary pricing page JS-rendered).
Entra ID authentication was supported on Basic/Standard/Premium but **not** on Enterprise or
Enterprise Flash tiers.

Source for Entra auth scope:
<https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-azure-active-directory-for-authentication>

**Do not select Azure Cache for Redis for new work.** Use Azure Managed Redis.

---

## Option 3 — Azure Web PubSub

### What it is and what it does NOT do

Azure Web PubSub is a fully managed real-time messaging service. It manages WebSocket connections
at scale and fans out messages to groups of connected clients. **It does not store application
state.** The room state must live somewhere else; Web PubSub could carry state *changes*
(push notifications to players) but cannot be the source of truth for room data.

From the official overview (updated 2026-08-06):
> "Azure Web PubSub is a fully managed service for building applications that deliver updates in
> real time. It manages long-lived client connections and message delivery at scale."

Source: <https://learn.microsoft.com/en-us/azure/azure-web-pubsub/overview>

### Confirmed pricing — eastus2

All prices from the Azure Retail Prices API, queried at:
`https://prices.azure.com/api/retail/prices?$filter=armRegionName eq 'eastus2' and contains(productName,'Web PubSub')`
Fetched: 2026-08-11. `armRegionName: eastus2`, `currencyCode: USD`.

**Full result set (Count: 5):**

| skuName | meterName | retailPrice | unitOfMeasure | Derived monthly | effectiveStartDate | skuId |
|---------|-----------|-------------|---------------|-----------------|--------------------|-------|
| Standard | **Standard Unit - Free** | **$0.00** | 1/Day | **$0/month** | 2022-03-01 | DZH318Z08P48/000L |
| Standard | Standard Unit | $1.61 | 1/Day | **~$49/month** | 2022-03-01 | DZH318Z08P48/000L |
| Standard | Standard Message | $1.00 | 1M | per-use | 2022-03-01 | DZH318Z08P48/000L |
| Premium | Premium Unit | $2.00 | 1/Day | **~$61/month** | 2023-02-01 | DZH318Z08P48/0032 |
| Premium | Premium Message | $1.00 | 1M | per-use | 2023-02-01 | DZH318Z08P48/0032 |

Monthly derivations: Standard Unit = $1.61 × 30.44 days = $49.01; Premium Unit = $2.00 × 30.44 = $60.88.

**There is no eastus2-specific pricing for Web PubSub** — `isPrimaryMeterRegion: false` on all
rows. The API does return items for `armRegionName: eastus2`, so the service is available there;
the `false` flag means billing is anchored to a primary region meter (the prices are the same
globally for this service).

### Free tier — documented limits

The free tier is confirmed both by the API (`Standard Unit - Free` meter at $0.00/day) and by
Microsoft Learn documentation:

> Free tier includes: **20 concurrent connections, 20,000 messages per day, 1 unit per
> subscription.**

Source: <https://azure.microsoft.com/en-us/pricing/details/web-pubsub/> and Microsoft Learn
Web PubSub overview.

**The free tier is the Standard SKU** (same `skuId: DZH318Z08P48/000L` as the paid Standard Unit
meter, with a separate `Standard Unit - Free` meter at $0.00). This is confirmed by the API
response showing both `Standard Unit - Free` ($0.00) and `Standard Unit` ($1.61) under
`skuName: Standard`.

### Does the free tier support Microsoft Entra ID / managed identity?

**Yes.** Entra ID authorization is a feature of the Web PubSub service (the Standard SKU tier),
not a paid add-on. The free tier is a capped unit of the Standard SKU. Role-based access control
with managed identities is documented for the Standard service:

Source: <https://learn.microsoft.com/en-us/azure/azure-web-pubsub/concept-azure-ad-authorization>
(updated 2026-03-25)

The server uses the managed identity to call the Web PubSub REST API (send messages, manage
groups, generate client access tokens). Clients connect using short-lived tokens generated by the
server — the managed identity does not appear on the client side.

### Budget verdict

| Scenario | Monthly cost | Fits $10 budget? |
|----------|-------------|-----------------|
| Free tier (20 connections, 20K msg/day) | **$0/month** | ✅ Yes — if limits fit the design |
| Standard paid (1 unit = 1,000 connections) | ~$49/month | ❌ No — 5× the budget |
| Premium (1 unit) | ~$61/month | ❌ No |

**The free tier fits the budget** — but 20 concurrent connections is a hard constraint. A room
with 6 players means up to 6 client connections plus server connections (default 5 per hub),
totalling up to 11 connections per active room. Two simultaneous rooms approaches the 20-
connection ceiling. For a hobby game with one room at a time, the free tier is viable; for
anything resembling concurrent use, it is not. The first paid tier ($49/month) is 5× the budget.

### Atomic room operations

Not applicable — Web PubSub does not store state. It cannot be the system of record for any of
the three atomic operations. It would need to be paired with a state store.

### Verdict

Web PubSub is a *transport* option relevant to ticket
[03-research-realtime-transport.md](../issues/03-research-realtime-transport.md), not a state
store. The free tier is budget-compatible for single-room-at-a-time use; the first paid tier
destroys the budget. Do not conflate it with state storage.

## Option 4 — Azure Cosmos DB Serverless

### What it is

Cosmos DB Serverless is a consumption-billed NoSQL document store. There is no provisioned
throughput; you pay per request unit (RU) consumed and per GB stored. It is single-region only
(cannot add regions after creation).

Source: <https://learn.microsoft.com/en-us/azure/cosmos-db/serverless> (updated 2025-07-24)

### Cost

| Dimension | Price | Region/date confirmed |
|-----------|-------|----------------------|
| Per 1 million RU consumed | ~$0.25 | eastus-region; web search citing Azure pricing page, 2026-08-11 |
| Per GB transactional storage | ~$0.25/month | same source |

A room write (replace whole room document, ~1 KB) consumes approximately 10–15 RU. A read
consumes 1 RU per KB. At typical hobby/small multiplayer scale (hundreds of rooms, each with
dozens of writes per round), monthly RU cost would be **well under $1**. Storage for room
documents (kilobytes, short-lived) is negligible.

**Budget impact: effectively free at this scale.** A realistic monthly cost is $0.01–$0.10.

Source for pricing: <https://azure.microsoft.com/en-us/pricing/details/cosmos-db/serverless/>

### Write latency

Cosmos DB is a distributed database with strong consistency by default. Single-region write latency
from an eastus2 Container App to a Cosmos DB serverless account in the same region is typically
5–15 ms for a point write. This is measurably slower than Redis but fast enough for a room-join
or submission-record operation.

### Atomic operations for room state

Cosmos DB Serverless supports optimistic concurrency via **ETags** on every document. The
`_etag` property is returned on every read and must be supplied in an `If-Match` header on
conditional writes. Behaviour:

| Operation | Cosmos DB mechanism |
|-----------|---------------------|
| "Add player only if room not full" | Read document (get ETag), check player count client-side, write back with `If-Match: <etag>` — 412 if concurrent writer raced ahead; retry loop required |
| "Record submission exactly once" | Insert new document; Cosmos DB returns 409 Conflict if a document with the same `id` already exists — equivalent to `putIfAbsent` |
| "First writer wins on room entity" | Insert with a fixed `id`; 409 on second writer — equivalent to `putIfAbsent` |

The "add player" operation requires a **read-modify-write loop** with retry under contention
(same as blob and table storage). It is correct under any concurrency level but adds latency when
two players try to join the same room simultaneously. For a small private room with ≤6 players,
contention is rare in practice.

### Microsoft Entra ID / managed identity authentication

**Yes — fully supported.** Cosmos DB for NoSQL supports data-plane RBAC with Entra ID. Key-based
auth can be disabled entirely.

Source: <https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control>
(updated 2026-04-29)

A new Cosmos DB account would require a new role assignment for the Container App's managed
identity (e.g. `Cosmos DB Built-in Data Contributor`). The zero-secrets property is preserved.

### Additional considerations

- **Serverless accounts are single-region only** — cannot be replicated later without creating a
  new account. Not a concern for this deployment (already single-region eastus2).
- **Cold start after complete idle:** Serverless scales to zero at the storage layer but the data
  plane endpoint stays up. There is no cold-start penalty equivalent to the Container App's 760 ms
  cold start.
- **Requires a new resource:** Cosmos DB is not yet part of this deployment.

---

## Option 5 — Azure Table Storage (existing storage account)

### What it is

Azure Table Storage is a NoSQL key-value store using `PartitionKey` + `RowKey` addressing,
already part of the `stlettersdaily90054` storage account (the same account that holds
`daily-challenges/`).

Source: <https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-design>

### Cost

**Zero extra cost** — the storage account already exists and is already paid for. Incremental cost:

| Dimension | Price | Source |
|-----------|-------|--------|
| Storage (LRS) | $0.045 per GB/month | web search citing <https://azure.microsoft.com/en-us/pricing/details/storage/tables/>, 2026-08-11 |
| Transactions | $0.00036 per 10,000 operations | same source |

Room state documents are kilobytes. At hundreds of rooms and thousands of writes per month,
incremental storage cost is **under $0.01/month** and incremental transaction cost is also
**under $0.01/month**. Effectively free at this scale.

### Write latency

Azure Table Storage is a REST-over-HTTPS service with shared infrastructure. Single-operation
write latency from eastus2 to the storage account in the same region is typically **5–20 ms**
(p50). This is slower than Redis but comparable to Cosmos DB.

### Atomic operations for room state

Table Storage supports two concurrency mechanisms:

**1. ETag-based optimistic concurrency (per entity)**

Every entity has a `Timestamp`-derived ETag. The Table service REST API supports `If-Match` on
update/delete and honours `If-None-Match` on insert.

Source: "The Table service uses this last-modified timestamp (LMT) to manage optimistic concurrency
... This document uses the terms ETag and LMT interchangeably."
<https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-design>

| Operation | Table Storage mechanism |
|-----------|------------------------|
| "Add player only if room not full" | Read entity (get ETag), check client-side, write back with `If-Match: <etag>` — 412 if concurrent; retry loop required |
| "Record submission exactly once" | `InsertOrReplace` is NOT safe; use plain `Insert` — Table Storage returns **409 Conflict** if the entity already exists. This covers "first writer wins / putIfAbsent" exactly. |
| "First writer wins on room entity" | Plain `Insert` with fixed (PartitionKey, RowKey) — 409 on second writer |

**2. Entity Group Transactions (EGTs)**

EGTs allow atomic batch operations on up to 100 entities within the **same partition** (same
`PartitionKey`). This is more powerful than single-entity ETags for compound operations like "add
player AND increment player count atomically".

Source: "EGTs can only operate on entities stored in the same partition ... EGTs are the only
built-in mechanism for performing atomic updates across multiple entities."
<https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-design>

**Design implication:** All entities for one room (room header, player list, submission records)
should share the same `PartitionKey` (e.g., the room code) to be eligible for EGT atomicity.

**Comparison with Blob Storage:** Table Storage has a meaningful advantage over Blob Storage for
rooms with multiple entities (room header + per-player submissions) because EGTs can atomically
update several entities in one partition. Blob can only do one blob at a time.

### Microsoft Entra ID / managed identity authentication

**Yes — the existing managed identity already has `Storage Blob Data Contributor` on
`stlettersdaily90054`.** Table Storage uses a different set of roles:

- `Storage Table Data Reader` — read access
- `Storage Table Data Contributor` — read+write (what rooms need)

A second role assignment on the same storage account would be required. This is a one-line
infrastructure change, not a secret. The zero-secrets property is fully preserved.

Source: <https://learn.microsoft.com/en-us/azure/storage/tables/authorize-access-azure-active-directory>

---

## Option 6 — Azure Blob Storage (existing storage account)

### What it is

The existing `stlettersdaily90054` account already hosts `daily-challenges/` blobs.
`DailyChallengeStore` (`blobStore.ts`) demonstrates the exact `putIfAbsent` pattern a room store
would need:

```typescript
// Already proven in production:
await blobClient.upload(body, length, {
  conditions: { ifNoneMatch: '*' },  // 409/412 = someone else already stored it
});
```

Source: `src/server/bonus/blobStore.ts` in this repository.

### Cost

**Zero extra cost** — same account, already paid for. Blobs for rooms (kilobytes each, short-lived)
contribute negligibly to storage and transaction costs.

### Write latency

Same as Table Storage: 5–20 ms per operation (p50) from eastus2 for the same-region storage
account. Blob read/write latency is similar to Table Storage for small objects.

### Atomic operations for room state

The Blob service supports full ETag-based optimistic concurrency. The SDK already uses this
in `blobStore.ts`.

Source: <https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage> (updated 2025-07-30):

> "Azure Storage assigns an identifier to every object stored. This identifier is updated every
> time a write operation is performed on an object [the ETag]."
>
> "If the **If-Match** header is specified, Azure Storage verifies that the value of the ETag
> specified in the update request is the same as the ETag for the object being updated."

| Operation | Blob mechanism |
|-----------|---------------|
| "Add player only if room not full" | Read blob (get ETag), check player count client-side, `upload` with `conditions: { ifMatch: etag }` — 412 on concurrent write; **retry loop required** |
| "Record submission exactly once / first writer wins" | `upload` with `conditions: { ifNoneMatch: '*' }` — **exact `putIfAbsent` semantic, already proven in `blobStore.ts`** |
| "First writer wins on room entity" | Same `ifNoneMatch: '*'` on the room blob itself |

**Limitation vs Table Storage:** A room with separate per-player submission blobs cannot be
updated atomically across blobs in a single operation. Each blob is an independent ETag scope.
If the design stores the entire room state in one JSON blob, this is not a problem; if it stores
submissions as separate blobs, the "add player AND write first submission" cannot be atomic
without a different coordination mechanism.

**For the append-only `putIfAbsent` operations** (which is what `DailyChallengeStore` already
uses), **Blob ETag conditional writes fully cover the semantic.** The 409/412 maps exactly to the
"someone else won the race" case already handled in `blobStore.ts`.

### Microsoft Entra ID / managed identity authentication

**Yes — already configured.** The managed identity already has `Storage Blob Data Contributor`
on `stlettersdaily90054`. No new role assignments needed for blob-based rooms.

### Limitation: Hot-room write throughput

A single blob has no rate limit at the Azure level, but all writers to the same blob serialise
through ETag compare-and-swap. Under sustained contention (many concurrent submissions to the
same room), write throughput is bounded by round-trip latency: at 10 ms/operation, serialised
writers get ~100 writes/second to one blob. For a small private room with ≤6 players, this is
not a constraint.

---

## Cross-cutting concern: Session affinity (sticky sessions)

### What it is

Container Apps can pin an HTTP client to the same replica using a cookie, so that if two
requests from one player always land on the same container, in-process state would appear
consistent to that player.

### How it is configured

Set `ingress.stickySessions.affinity = "sticky"` in the ARM/Bicep template, or toggle "Session
affinity: Enabled" in the Ingress section of the Azure portal.

Source: <https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions> (updated 2025-06-30)

### Documented failure modes

The docs state directly:

> "Session stickiness is enforced using HTTP cookies. This feature is available in **single
> revision mode** when HTTP ingress is enabled. **A client might be routed to a new replica if
> the previous replica is no longer available.**"

Source: same URL.

There are four failure modes that destroy affinity:

| Event | Effect on affinity |
|-------|--------------------|
| Target replica becomes unavailable (crash, OOM, health-check failure) | Client is re-routed to a different replica; in-process room state on the old replica is lost |
| Scale-in removes the target replica | Same as above |
| Revision change (any change to image, env vars, scaling rules, etc.) | Single revision mode: old revision deprovisioned, all existing cookies become stale; all clients land on new-revision replicas |
| Scale-to-zero (minReplicas: 0) | All replicas removed; all in-process state is erased; no replica to route to |

### Interaction with minReplicas: 0

Sticky sessions offer **no protection** when minReplicas is 0. A period of inactivity will scale
the app to zero. When the next request arrives, a cold replica starts up with no room state.
Any room held only in-process memory is permanently lost.

### Conclusion

Session affinity is a latency optimisation for truly stateful connections (e.g., WebSocket
upgrade), not a substitute for an external state store. It cannot make an in-process `Map` safe
on this deployment. **Do not use sticky sessions as the sole room-state strategy.**

---

## Cross-cutting concern: Scale-to-zero and in-flight connections

### What happens when minReplicas: 0 and traffic stops

With `minReplicas: 0`, the KEDA-based autoscaler in Container Apps follows this sequence:

1. KEDA measures the scale metric (concurrent HTTP requests or TCP connections) every **30 seconds**
   (polling interval).
2. Once the metric drops to zero (or below the threshold), KEDA enters a **300-second cool-down
   period** before scaling the revision down to its minimum replica count.
3. Scale-down removes **100% of the replicas that need to shut down** in one step (not gradually).
4. When the last replica terminates, all in-process state — including any `Map<roomId, Room>` —
   is erased. There is no serialisation, no warning to in-flight connections.

Sources:
- Scale behavior table ("Cool down period: 300 seconds", "Scale down step: 100% of replicas that
  need to shut down"): <https://learn.microsoft.com/en-us/azure/container-apps/scale-app>
- "You aren't billed usage charges if your container app scales to zero.":
  same URL.

### Does any KEDA scale rule keep a replica alive while connections are open?

**Yes — with caveats.**

**HTTP scale rule:** Counts concurrent HTTP requests over a rolling 15-second window. An open
long-polling or SSE connection that is mid-request does hold the count above zero and therefore
prevents the cool-down from starting. However, WebSocket connections are HTTP-upgrade followed
by TCP — after the upgrade handshake, they are no longer counted as HTTP requests.

> "Every 15 seconds, the number of concurrent requests is calculated as the number of requests
> in the past 15 seconds divided by 15."
> Source: <https://learn.microsoft.com/en-us/azure/container-apps/scale-app>

**TCP scale rule:** Counts concurrent TCP connections. An open WebSocket counts as a TCP
connection for as long as it is open, and therefore does hold the TCP scale rule above zero.

**Therefore:** A TCP scale rule with `concurrentConnections: 1` would prevent scale-in while
any WebSocket (or other TCP connection) to that replica is open. However, the 300-second cool-
down still applies once connections drop, and a deployment change that creates a new revision
will deprovision the old revision regardless of open connections (in single-revision mode, traffic
is migrated to the new revision once it is healthy).

**Practical meaning for rooms:**
- If transport is WebSocket + TCP scale rule: a room with at least one connected player keeps
  its replica alive. When the last player disconnects, the replica may scale to zero 300 seconds
  later.
- In-process room state is still lost on scale-in, revision change, or crash — the TCP rule only
  delays scale-in while connections are present.
- An external store is still required for correctness.

---

## Managed identity compatibility summary

| Option | Entra ID / MI auth | Mechanism | Extra role assignment needed? |
|--------|--------------------|-----------|-------------------------------|
| Azure Managed Redis (AMR) | ✅ Yes | Entra token as Redis `AUTH` password; token refresh required | Yes — new resource + role |
| Azure Cache for Redis (legacy) | ✅ Basic/Standard/Premium only | Same token mechanism | Yes — retiring 2028, do not use |
| Azure Web PubSub | ✅ Yes (server → service REST API) | Managed identity for server-side API calls; client tokens are short-lived | Yes — new resource + role |
| Cosmos DB Serverless | ✅ Yes | Entra RBAC data plane (e.g. Cosmos DB Built-in Data Contributor) | Yes — new resource + role |
| Azure Table Storage | ✅ Yes | Same Entra RBAC as Blob Storage; `Storage Table Data Contributor` role | Yes — new role, same account |
| Azure Blob Storage | ✅ Yes (already configured) | `Storage Blob Data Contributor` already assigned to `stlettersdaily90054` | **None — already done** |

All options are compatible with the no-secrets mandate. Blob Storage requires no new role
assignments because it reuses the existing one.

---

## Atomic-operations compatibility summary

| Operation | Blob ETag | Table ETag + EGT | Cosmos DB ETag | Redis NX / Lua |
|-----------|-----------|------------------|---------------|----------------|
| `putIfAbsent` (create room / record submission once) | ✅ `If-None-Match: '*'` — 409/412 on collision — **already in use in `blobStore.ts`** | ✅ Plain `Insert` — 409 Conflict if entity exists | ✅ Insert — 409 Conflict if id exists | ✅ `SET key NX` |
| "First writer wins" (same as above) | ✅ same | ✅ same | ✅ same | ✅ same |
| "Add player if room not full" (read + conditional write) | ✅ read blob → check count → `If-Match: <etag>` upload; **retry loop required under contention** | ✅ read entity → check count → `If-Match: <etag>` update; retry loop required; or use EGT for multi-entity atomicity | ✅ read → check → `If-Match`; retry loop required | ✅ Lua script — atomic without retry; or `WATCH/MULTI/EXEC` |

**Key finding:** `putIfAbsent` and "first writer wins" are fully and correctly covered by Blob ETag
conditional writes (`If-None-Match: '*'`), with exactly the same semantics as
`DailyChallengeStore`. The "add player if not full" operation requires a retry loop on all storage-
backed options; Redis Lua scripts are the only option that can express this atomically in a single
server-side step.

---

## Comparison table

Pricing figures for Azure Managed Redis and Web PubSub are confirmed from the Azure Retail Prices
API (`prices.azure.com/api/retail/prices`), fetched 2026-08-11. All other figures as cited in
earlier sections.

| Dimension | Azure Managed Redis B0 | Cosmos DB Serverless | Azure Table Storage | Azure Blob Storage |
|-----------|------------------------|---------------------|---------------------|-------------------|
| **Confirmed monthly cost (PAYG, eastus2)** | **$11.68/month** (single-node non-HA) · **$7.58/month** (1-yr reserved) | ~$0.01–$0.10 | ~$0 extra | ~$0 extra |
| **Fits strict $10/month PAYG budget?** | ❌ $1.68 over (PAYG) · ✅ 1-yr reserved only | ✅ Yes | ✅ Yes (existing account) | ✅ Yes (existing account) |
| **New Azure resource needed?** | Yes | Yes | No (same account) | No (same account) |
| **Write latency (p50, same region)** | ~1–3 ms | ~5–15 ms | ~5–20 ms | ~5–20 ms |
| **`putIfAbsent` / first-writer-wins** | ✅ `SET NX` | ✅ Insert → 409 | ✅ Insert → 409 | ✅ `If-None-Match: '*'` (already in codebase) |
| **"Add player if not full" (compound CAS)** | ✅ Lua script (no retry) | ⚠️ ETag + retry loop | ⚠️ ETag + retry loop (EGT for multi-entity) | ⚠️ ETag + retry loop (single blob only) |
| **Managed identity auth** | ✅ Yes (token refresh required in client) | ✅ Yes | ✅ Yes (new role on same account) | ✅ Yes (already configured) |
| **Code pattern fit with existing codebase** | New pattern (Redis client + token refresh loop) | New pattern (Cosmos SDK) | Similar to blob (same Entra credential) | **Identical pattern** (same `@azure/storage-blob` SDK, already proven) |
| **Scale-to-zero compatible** | ✅ Yes (external store) | ✅ Yes | ✅ Yes | ✅ Yes |

**Web PubSub** is excluded from this table because it is not a state store. See Option 3 for its
role as a transport layer.

---

## Recommendations (ranked; human to decide)

### Does the new pricing change the ranking?

**No.** The B0 PAYG price of $11.68/month confirms that Redis exceeds the $10/month budget by
$1.68/month on a pay-as-you-go basis. A 1-year committed reservation at $7.58/month fits, but
that is a qualitatively different decision (committed spend vs. zero incremental cost). The
ranking of the storage-based options is unchanged.

---

### 1st: Azure Blob Storage in the existing storage account

**Tradeoff accepted:** 5–20 ms write latency per operation; the "add player if not full"
operation requires a client-side retry loop under write contention (rare at ≤6 players/room).

**Why it ranks first:**
- Zero extra cost — the account, managed identity, and `Storage Blob Data Contributor` role
  are already configured and proven in production.
- `DailyChallengeStore` (`blobStore.ts`) already demonstrates every pattern a `RoomStore` needs:
  `get`, `put`, and `putIfAbsent` via `If-None-Match: '*'` ETag conditional writes. The
  adapter would look structurally identical.
- No new Azure resource, no new SDK, no new authentication mechanism, no token-refresh loop.
- Fully preserves the zero-secrets property with zero additional work.

**When it stops working:** Sustained high-frequency concurrent writes to the same room blob
(many players submitting within milliseconds of each other). Unlikely in a private room of ≤6
players with any realistic round design.

---

### 2nd: Azure Table Storage in the existing storage account

**Tradeoff accepted:** Same 5–20 ms write latency; one new role assignment required
(`Storage Table Data Contributor` on the existing storage account).

**Why it ranks second over blob:**
- Still zero extra monetary cost.
- **Entity Group Transactions (EGTs)** allow atomic multi-entity updates within one partition
  (e.g., atomically update the room-header entity AND a per-player submission entity in one
  operation). Blob cannot do this — each blob is an independent ETag scope.
- If the room data model (ticket 01) results in multiple entity types per room that must be
  co-updated atomically (room state + per-player records), Table Storage handles this
  more cleanly than a single-document blob approach.
- Plain `Insert` returns 409 Conflict if the entity already exists — native `putIfAbsent`.

**When to prefer Table over Blob:** Once ticket 01 resolves the room data model, if a room
needs multiple independently-addressable entities within a partition (e.g., separate rows for
room metadata, each player's state, and each player's submission), Table's EGT atomicity
becomes a genuine advantage over blob.

---

### 3rd: Azure Cosmos DB Serverless

**Tradeoff accepted:** Requires provisioning a new Azure resource (new account, new role
assignment, infrastructure-as-code changes). Sub-$1/month cost is well within budget
but non-zero.

**Why it ranks third:**
- Clean document model; `_etag` on every document; 409 on duplicate insert.
- Entra ID RBAC supported; `disableLocalAuth: true` enforces key-free access.
- Cost at this scale: effectively negligible ($0.01–$0.10/month).

**When to prefer Cosmos:** If the room data model needs richer queries or a native document API,
or if a future multi-service architecture already has Cosmos DB as a dependency.

---

### Not ranked: Azure Managed Redis B0

**PAYG cost confirmed at $11.68/month — $1.68/month over the $10 budget ceiling.**

A 1-year reserved B0 fits at $7.58/month, but that requires a committed annual purchase and a
new resource provisioning effort. Given that Blob Storage costs nothing extra and already has its
`putIfAbsent` pattern proven in production, the case for committing to Redis at any price point
is difficult to make until:

1. The multiplayer design (ticket 01) produces a write pattern that genuinely stresses the
   5–20 ms blob latency (Redis's main advantage), **or**
2. The "add player if not full" compound atomic operation proves problematic in practice under
   real contention (Lua scripts are Redis's other concrete advantage over storage options).

If either condition arises during prototyping, Redis should be reconsidered at that point.

**Note also:** The Node.js Entra token-refresh integration for Azure Managed Redis is not
officially wrapped in a maintained Azure SDK library (unlike the .NET `Microsoft.Azure.StackExchangeRedis` package). This implementation overhead is a real cost.

---

### Not ranked: Azure Web PubSub

**Not a state store.** The free tier is budget-compatible (confirmed $0/month, 20 connections/day)
and supports Entra ID auth. Evaluate for the transport layer in ticket 03, not for room state.
The first paid tier at ~$49/month is 5× the total budget.

## Open questions / gaps

1. ~~**Azure Managed Redis B0 price is unconfirmed.**~~ **Closed 2026-08-11.** The pricing page is
   JavaScript-rendered and shows `$-`, but the **Azure Retail Prices API** — a first-party,
   unauthenticated JSON endpoint — returns the figures directly, and the Redis, Web PubSub and
   legacy Cache sections above have been rewritten from it. B0 Balanced is **$0.016/hr =
   $11.68/month** PAYG single-node in eastus2. Query used:
   `https://prices.azure.com/api/retail/prices?$filter=armRegionName eq 'eastus2' and contains(productName,'Managed Redis')`
   Documented at <https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices>
   — **prefer this over the pricing pages for any future Azure cost question in this repo.**

2. **Azure Managed Redis Node.js Entra token refresh.** The .NET path uses
   `Microsoft.Azure.StackExchangeRedis`; the equivalent Node.js path is not officially documented
   in the Managed Redis docs beyond acquiring a token with `DefaultAzureCredential`. If Redis is
   chosen, this integration pattern should be prototyped before the spec commits to it. Note the
   app already solves the analogous problem for Foundry by passing a *token-provider function* the
   SDK calls per request, rather than a token — the same shape may apply.

3. **Room data model is unresolved (ticket 01 is open).** The best store depends on whether the
   design stores one blob/document per room (blob is fine) or multiple entities per room that need
   atomic co-update (table's EGTs become attractive). This research deliberately answers the
   general case; re-read the Table Storage recommendation once ticket 01 is resolved.

4. **Cooldown-period and in-flight WebSocket behaviour** needs verification against whatever
   transport is chosen (ticket 03). The 300-second cooldown applies after the last connection
   closes; if rooms have idle periods mid-game, this matters.

5. **Whether a committed reservation is acceptable at all.** The only Redis price that fits the
   budget ($7.58/month) is a 1-year reservation, which is a commitment to a year of spend on a
   feature that has not shipped. That is a judgement for the human, not a research finding.

---

## Primary sources cited

| URL | What it was used for | Last updated (as fetched) |
|-----|----------------------|--------------------------|
| <https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions> | Session affinity configuration and failure modes | 2025-06-30 |
| <https://learn.microsoft.com/en-us/azure/container-apps/scale-app> | Scale-to-zero behaviour, KEDA rules, cool-down period, scale-down step | 2026-05-20 |
| <https://learn.microsoft.com/en-us/azure/container-apps/revisions> | Revision modes and lifecycle | 2026-02-26 |
| <https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq> | Redis retirement date (Sept 30, 2028) and migration guidance | 2026-03-26 |
| <https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-azure-active-directory-for-authentication> | Azure Cache for Redis Entra auth scope (Basic/Standard/Premium only) | 2026-03-25 |
| <https://azure.microsoft.com/en-us/pricing/details/managed-redis/> | Azure Managed Redis tiers and Entra ID auth column | fetched 2026-08-11 |
| <https://learn.microsoft.com/en-us/azure/redis/entra-for-authentication> | Azure Managed Redis Entra auth flow | cited via web search |
| <https://learn.microsoft.com/en-us/azure/azure-web-pubsub/overview> | Web PubSub capabilities and state storage (none) | 2026-08-06 |
| <https://learn.microsoft.com/en-us/azure/azure-web-pubsub/concept-azure-ad-authorization> | Web PubSub Entra/MI authorization | 2026-03-25 |
| <https://learn.microsoft.com/en-us/azure/azure-web-pubsub/howto-use-managed-identity> | Web PubSub managed identity usage | 2024-08-27 |
| <https://azure.microsoft.com/en-us/pricing/details/web-pubsub/> | Web PubSub Free tier limits | fetched 2026-08-11 |
| <https://learn.microsoft.com/en-us/azure/cosmos-db/serverless> | Cosmos DB Serverless use cases and characteristics | 2025-07-24 |
| <https://azure.microsoft.com/en-us/pricing/details/cosmos-db/serverless/> | Cosmos DB Serverless pricing (~$0.25/million RU) | fetched 2026-08-11 |
| <https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control> | Cosmos DB Entra RBAC / disable key auth | 2026-04-29 |
| <https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-design> | Table Storage EGTs, ETag LMT, capacity targets | 2025-07-02 |
| <https://learn.microsoft.com/en-us/azure/storage/tables/table-storage-design-patterns> | Table Storage EGT atomicity within a partition | 2025-09-23 |
| <https://learn.microsoft.com/en-us/azure/storage/tables/authorize-access-azure-active-directory> | Table Storage Entra ID auth and RBAC | 2025-10-16 |
| <https://learn.microsoft.com/en-us/azure/storage/blobs/concurrency-manage> | Blob ETag optimistic concurrency (If-Match, If-None-Match) | 2025-07-30 |
| `src/server/bonus/blobStore.ts` (this repository) | `putIfAbsent` via `If-None-Match: '*'` — already in production | — |
