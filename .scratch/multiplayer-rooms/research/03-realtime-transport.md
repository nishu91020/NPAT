
# How does realtime transport fit this server? — Research findings

Type: research
Status: complete
Ticket: [03-research-realtime-transport.md](../issues/03-research-realtime-transport.md)

**Research date:** 2026-08-11 | **Docs freshness:** Vite source read from `vitejs/vite` main branch SHA `733059ef` (fetched 2026-08-11). All Microsoft Learn pages confirmed updated between 2025-05-02 and 2026-08-06. Node.js API docs fetched live. ws and socket.io docs from official GitHub/site.

---

## Summary

Five options were evaluated against this server's specific constraints. The single highest-risk unknown — Vite HMR WebSocket coexistence in `middlewareMode` — is **resolved and solvable** using ws's documented `noServer: true` pattern, but requires deliberate path-scoped routing on the `'upgrade'` event. Raw `ws` is the lightest WebSocket fit for this stack. The critical missing piece for multi-replica deployment is a pub/sub backplane: every option except Azure Web PubSub needs one, and Web PubSub exceeds the $10/month budget. Plain HTTP polling is a genuine first-version option: it is the only transport that naturally survives multiple replicas without a backplane (state already lives in the shared store). SSE is a strong middle ground: server-push with zero new deps, automatic reconnection, no upgrade collision — but needs the same backplane as WebSocket for cross-replica fan-out. The ranking at the end is ordered by fit for the current constraints, not by what would be chosen at scale.

---

## Verified local observations

| Fact | Source | Value |
|------|--------|-------|
| Vite installed version | `node_modules/vite/package.json` (viewed) | **6.4.3** (package.json specifies `^6.2.3`; lock file resolved to 6.4.3) |
| esbuild build command | `package.json` `scripts.build` (viewed) | `esbuild src/server/main.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs` |
| `ws` in top-level node_modules | `node_modules/ws/` (glob checked) | **Not present as a top-level package.** ws is a transitive dep inside Vite's own distribution. Adding `ws` directly installs a second, independent copy alongside Vite's internal one. |
| Server shutdown handler | `src/server/main.ts` (viewed) | SIGTERM handler calls `server.close()` + 10s forced exit. Does **not** currently close a WebSocket server — must be added. |

---

## Q1 — ⚠️ HIGHEST RISK: Vite HMR WebSocket coexistence in `middlewareMode`

> **⚠️ CORRECTED AFTER EMPIRICAL VERIFICATION (2026-08-11).** The original version of this section
> concluded that Vite attaches its HMR WebSocket to the Express `http.Server` and that an app
> WebSocket must therefore share the `'upgrade'` event with it. **That is wrong for this repo.**
> Running `npm run dev` and listing listening sockets shows two ports, not one:
>
> ```
> LocalAddress LocalPort OwningProcess
> ::               24678         21924      <- Vite HMR, its own http.Server
> 0.0.0.0           3000         21924      <- Express
> ```
>
> Both are the same PID — one process, two listeners. The reason is below. The corrected finding is
> that **in this repo there is no upgrade collision to solve at all**, which retires the biggest
> risk on this ticket. The original analysis is kept below because it becomes correct the moment
> anyone sets `server.hmr.server`, and because the Node `'upgrade'` semantics it documents still
> govern any second listener added to the Express server.

### How Vite attaches its WebSocket in middlewareMode — verified from source *and* at runtime

**Primary source:** `vitejs/vite:packages/vite/src/node/server/ws.ts`, SHA `733059ef78048ca74f9ef1b3ccac1ec2441baff3`, fetched 2026-08-11. Cross-checked against the **installed** build at `node_modules/vite/dist/node/chunks/dep-Dm0c1Wj2.js` (Vite 6.4.3, the version this repo actually resolves).

`createWebSocketServer(server, config, httpsOptions)` receives Vite's **own** `httpServer` as its first argument — *not* the app's. It then decides which HTTP server to attach to:

```typescript
// ws.ts (paraphrased)
const wsCustomServer = wsOptions?.server;           // config.server.hmr.server, if set
const wsPort        = wsOptions?.port;              // config.server.hmr.port, if set
const portsAreCompatible = !wsPort || wsPort === config.server.port;
const wsServer = wsCustomServer || (portsAreCompatible && server);
```

⚠️ **The decisive fact: in `middlewareMode`, Vite creates no HTTP server**, so the `server` argument above is `null`. `vite.config.ts` here sets neither `server.hmr.server` nor `server.hmr.port`, so `wsCustomServer` is undefined too — and `wsServer` is therefore **falsy**. Vite takes the `else` branch and stands up a **standalone HTTP server of its own** on the default HMR port `24678`:

```typescript
wsHttpServer = createServer(route);                 // Vite's own server, port 24678
wsHttpServer.on('upgrade', (req, socket, head) => { /* ... */ });
```

That is exactly what the port listing above shows. **Vite never registers an `'upgrade'` listener on the Express server**, so an app WebSocket on port 3000 has the `'upgrade'` event entirely to itself, and `src/server/main.ts` needs no path-scoped arbitration to coexist with HMR.

Two consequences worth carrying into the spec:

- **Production is unaffected either way.** `NODE_ENV=production` never imports Vite, so no HMR socket exists in the deployed container. The collision question was only ever a development-time one.
- **This is contingent, not guaranteed.** It holds *because* the repo uses `middlewareMode` and leaves `hmr.server` unset. `vite.config.ts` carries an explicit "do not modify" comment on its HMR block, which helpfully protects the arrangement — but if anyone ever passes `hmr.server`, Vite attaches to the app's server and the shared-`'upgrade'` analysis below becomes live again. **Pin this with a test** rather than trusting it to stay true across a Vite upgrade.

### The original shared-server analysis (applies only if `server.hmr.server` is ever set)

Were Vite attached to the Express server, it would create its WS server in `noServer` mode — no port of its own:

```typescript
const wss = new WebSocketServerRaw({ noServer: true });
```

And register one `'upgrade'` listener on the app's `http.Server`:

```typescript
hmrServerWsListener = (req, socket, head) => {
  const protocol = req.headers['sec-websocket-protocol']!;
  const parsedUrl = new URL(`http://example.com${req.url!}`);
  if (
    [HMR_HEADER, 'vite-ping'].includes(protocol) &&   // 'vite-hmr' or 'vite-ping'
    parsedUrl.pathname === hmrBase                     // '/' by default
  ) {
    handleUpgrade(req, socket as Socket, head, protocol === 'vite-ping');
  }
  // ← if neither condition matches: the function returns without doing anything
  // It does NOT destroy the socket.
};
wsServer.on('upgrade', hmrServerWsListener);
```

`HMR_HEADER = 'vite-hmr'` (exported constant, top of ws.ts). This listener body was confirmed verbatim in the installed 6.4.3 build.

**Vite's upgrade listener acts on a request if and only if:**
1. The `sec-websocket-protocol` header is exactly `'vite-hmr'` or `'vite-ping'`, **AND**
2. The request pathname equals `hmrBase` (default: `'/'`)

If either condition fails, the function returns silently. It does **not** destroy the socket. It does **not** write a 400 response. It does nothing — which is what would make coexistence safe.

### The `server.hmr.server` option explained

`server.hmr.server` points Vite's WS server at an existing `http.Server` instance — the supported way to put HMR on the *same* port as the app in `middlewareMode`. **This repo does not set it, and the finding above is a direct consequence of that.** Setting it would move HMR onto port 3000 and make the shared-`'upgrade'` handling above mandatory; leaving it unset keeps HMR on 24678 and keeps the app's upgrade path clean. Either is workable — but the choice must be deliberate, and the spec should say which.


### Node.js `'upgrade'` event semantics — the mechanism that makes coexistence work

Source: [https://nodejs.org/api/http.html#event-upgrade-1](https://nodejs.org/api/http.html#event-upgrade-1) (fetched 2026-08-11):

> "Emitted each time a client's HTTP upgrade request is accepted. **By default all HTTP upgrade requests are ignored** (i.e. only regular `'request'` events are emitted, sticking with the normal HTTP request/response flow) **unless you listen to this event, in which case they are all accepted** (i.e. the `'upgrade'` event is emitted instead, and future communication must be handled directly through the raw stream)."

The key rules:

1. **Before any `'upgrade'` listener:** WebSocket handshakes are silently destroyed by Node. Browser `new WebSocket(...)` gets a connection reset.
2. **After the first `'upgrade'` listener is added:** Node stops auto-destroying upgrade sockets. From this point on, **every registered `'upgrade'` listener receives every upgrade request** — there is no routing; Node fans the event out to all listeners.
3. **Consequence:** When Vite registers its listener, it "opens the gate." Your app WS listener (registered after) also receives every upgrade event. If a request matches neither Vite's path+protocol guard nor your path guard, nobody destroys the socket — it leaks. **The last or only listener that doesn't match must call `socket.destroy()`.**

Note: `server.closeAllConnections()` explicitly does **not** close upgraded WebSocket connections (Node.js docs: "This does not destroy sockets upgraded to a different protocol, such as WebSocket or HTTP/2" — [https://nodejs.org/api/http.html#servercloseallconnections](https://nodejs.org/api/http.html#servercloseallconnections)). WebSocket servers must be shut down explicitly in the SIGTERM handler.

### Concrete, verified recommendation: attaching an app WebSocket alongside Vite HMR

The ws README documents this exact pattern: [https://github.com/websockets/ws/blob/master/README.md#multiple-servers-sharing-a-single-https-server](https://github.com/websockets/ws/blob/master/README.md#multiple-servers-sharing-a-single-https-server)

```typescript
// In startServer(), after the vite.createServer() / app.listen() block

import { WebSocketServer } from 'ws';

const appWss = new WebSocketServer({ noServer: true });

// Register AFTER server is created and listening:
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url!, `http://localhost:${PORT}`);

  if (pathname === '/ws/rooms') {
    // Vite's listener has already been called; its guard failed (protocol
    // is not 'vite-hmr' and/or path is not '/'), so it did nothing.
    // We own this path.
    appWss.handleUpgrade(req, socket, head, (ws) => {
      appWss.emit('connection', ws, req);
    });
  } else if (pathname !== '/') {
    // '/' is Vite's HMR path. For all OTHER unrecognised paths, destroy
    // to prevent socket leaks. Vite handles '/' — do not touch it here.
    socket.destroy();
  }
  // pathname === '/' → Vite's listener handles it; we fall through.
});

appWss.on('connection', (ws, req) => {
  // room logic
});

// SIGTERM shutdown — add inside existing shutdown handler:
// server.close(async () => {
//   appWss.close();          // ← ADD THIS
//   appWss.clients.forEach(ws => ws.terminate());
//   await flushTelemetry();
//   process.exit(0);
// });
```

**Why this is safe:**
- Vite's listener is registered when `createViteServer()` resolves (before `app.listen()` completes). Your listener is registered after. Node calls both for every upgrade, Vite's first.
- Vite's guard (`protocol === 'vite-hmr' && pathname === '/'`) fails for any request to `/ws/rooms` (no special protocol, different path). Vite does nothing. Your listener handles it.
- In production (`NODE_ENV=production`), Vite is never imported, no `hmrServerWsListener` is registered. Your listener is the only one. Everything works identically — actually simpler.
- Vite cleans up its listener on `vite.close()` (`wsServer.off('upgrade', hmrServerWsListener)` in ws.ts `close()` method), so HMR shutdown is tidy.

---

## Q2 — Transport option comparison

### Option A: Raw `ws`

**Attachment to Express + http.Server:** `WebSocketServer({ noServer: true })` + `server.on('upgrade', ...)` as shown above. No wrapping of Express is needed. The `ws` package is added to `dependencies` and used as a direct dep (separate from Vite's internal copy).

**Multiple replicas:** ❌ No cross-replica backplane. A WebSocket connection on replica A cannot receive an event emitted on replica B. The required backplane is Redis pub/sub (Azure Cache for Redis, ~$16/month for C1 Basic) or Azure Service Bus (~$0.05/million operations). Neither is currently provisioned. This problem is identical across all in-process WebSocket options (ws, socket.io, SSE).

**Reconnection:** ❌ No built-in client reconnection. The browser `WebSocket` API does not auto-reconnect. Implement in ~15 lines with exponential backoff, or use a small wrapper like `reconnecting-websocket` (2KB min+gz).

**Browser support:** ✅ All modern browsers. `WebSocket` is a baseline web platform feature. Source: [https://developer.mozilla.org/en-US/docs/Web/API/WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

**Dependency/bundle weight:** `ws` itself is ~60KB installed, zero native deps required on Node ≥ 18.14. Optional native `bufferutil` improves frame-masking performance; optional `utf-8-validate` improves UTF-8 checking on Node < 18.14 (irrelevant here: repo requires ≥ 22.12). Both are declared `--save-optional` ([https://github.com/websockets/ws/blob/master/README.md](https://github.com/websockets/ws/blob/master/README.md)). If absent, ws falls back to pure JS with no error.

**esbuild bundling:** ✅ Clean. `--packages=external` means ws is `require('ws')` at runtime, never bundled. Native deps are a container Dockerfile concern, not a build concern. No esbuild flags needed.

**Testability in Vitest (node env, no plugins):** ✅ Easiest WebSocket option. `http.createServer()` → `WebSocketServer({noServer:true})` → listen on port 0 (OS assigns) → connect with `new WebSocket('ws://localhost:PORT')` from the ws client. Standard, fast, no external process needed.

---

### Option B: `socket.io`

**Attachment:** `new Server(httpServer)` or `io.attach(httpServer)`. engine.io registers its own `'upgrade'` listener on the http.Server internally. Default path is `/socket.io/`, which does not conflict with Vite's `'/'` path. Coexists correctly without manual path routing (though path-routing is still good practice to be explicit).

**Multiple replicas:** ❌ Same problem. Solution: `@socket.io/redis-adapter` ([https://socket.io/docs/v4/redis-adapter/](https://socket.io/docs/v4/redis-adapter/)), which uses Redis pub/sub to broadcast across the cluster. Requires a Redis instance. Note: the Redis adapter **does not support connection state recovery** (disconnected clients lose state on reconnect — confirmed in the adapter feature table).

**Transport negotiation:** socket.io 4.x defaults to HTTP long-polling first, then upgrades to WebSocket. This means the first connection attempt makes at least one HTTP poll request before upgrading. Can be forced to WebSocket-only with `transports: ['websocket']` on both client and server, but this loses socket.io's polling fallback.

**Reconnection:** ✅ Built-in, automatic, with exponential backoff. The client SDK handles all of this. This is socket.io's primary advantage over raw ws.

**Browser support:** ✅ All modern browsers. The client needs `socket.io-client`.

**Dependency tree:** 21 packages total (verified from [https://socket.io/docs/v4/server-installation/#dependency-tree](https://socket.io/docs/v4/server-installation/#dependency-tree)). socket.io 4.8.x → engine.io 6.6.x → ws 8.17.1. Same optional `bufferutil`/`utf-8-validate` as raw ws.

**esbuild bundling:** ✅ Clean. All 21 packages are external. No bundling.

**Testability in Vitest:** ✅ Works. Use `socket.io-client` with `transports: ['websocket']` to skip the polling phase. Slightly more setup than raw ws.

**Verdict:** socket.io adds built-in reconnection and a Redis adapter as a package deal. For this codebase, which already plans a thin port-based room store, socket.io's own namespace/room abstraction competes with rather than complements that design. Raw ws with manual reconnection (15 lines) and a direct Redis pub/sub client is leaner and more idiomatic.

---

### Option C: Server-Sent Events over plain Express

**Attachment:** A plain GET route. No WebSocket, no upgrade event, no new package:

```typescript
app.get('/api/rooms/:id/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  const cleanup = () => { clearInterval(heartbeat); };
  req.on('close', cleanup);
  res.on('close', cleanup);

  // subscribe to room events and write:
  // res.write(`data: ${JSON.stringify(event)}\n\n`);
});
```

The browser uses the native `EventSource` API: `new EventSource('/api/rooms/ABC/events')`.

**Vite HMR collision:** ✅ None. SSE is a plain GET response; it never touches the `'upgrade'` event path.

**Multiple replicas:** ❌ An SSE stream is to one replica. Cross-replica fan-out still needs a pub/sub backplane (same Redis/Service Bus requirement as WebSocket). However: the backplane **only needs to deliver events to the app server**, which then writes them to the open SSE stream. There is no persistent connection at the backplane level per client — simpler than WebSocket backplane management.

**Reconnection:** ✅ The browser `EventSource` automatically reconnects on disconnect (with default 3-second delay, configurable via `retry:` field). It resumes from the last event ID if the server uses `id:` fields in the event stream. This is the best built-in reconnection story of any option here — it is in the browser standard itself.

**Direction:** ❌ Server-to-client only. Client-to-server messages (join room, mark ready, submit answer) go over regular HTTP POST, which is already how this app works (`/api/validate`). For a word game with an asymmetric protocol (server pushes state; client submits answers), this is a natural fit.

**Browser support:** ✅ All modern browsers. `EventSource` is not supported in IE (irrelevant). Source: [https://developer.mozilla.org/en-US/docs/Web/API/EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)

**240-second idle timeout:** ⚠️ SSE is a long-lived HTTP response and is subject to the ACA 240-second request timeout ([https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)). **Mitigation:** write a comment (`': heartbeat\n\n'`) every 30–60 seconds. The browser `EventSource` ignores comment lines; the ingress proxy sees traffic and resets its idle clock. This is standard practice.

**Dependency/bundle weight:** Zero. No new npm package. SSE uses the standard Express `res` object.

**esbuild bundling:** ✅ N/A.

**Testability in Vitest:** ✅ Easiest of all options. Use Node's `http.get()` or `fetch()` to connect; read the response body as a text stream. Parse `data:` lines. No WebSocket client needed.

---

### Option D: Plain HTTP polling

**Attachment:** A standard GET route returning room state JSON. No long-lived connection.

**Multiple replicas:** ✅ **The only in-process transport that naturally survives multiple replicas without a backplane.** Every replica reads room state from the shared store (Azure Blob or Redis — already required by the map's "room store should look like `DailyChallengeStore`"). Every poll gets consistent state regardless of which replica serves it.

**Reconnection:** ✅ Implicit. Each poll is an independent HTTP request; if one fails, the next one retries. No disconnect to reconnect from.

**Browser support:** ✅ Universal. Standard `fetch()`.

**Disconnect detection:** ⚠️ The server cannot immediately know when a player closes their tab. Last-poll timestamp is the only signal. Treatment as disconnected after 3–5 missed polls = 3–10 seconds of lag. For a lobby, this is fine. For mid-round, a player's tab disappearing might not be noticed until the round ends.

**Dependency/bundle weight:** Zero. No new package.

**esbuild bundling:** ✅ N/A.

**Testability in Vitest:** ✅ Trivially testable with `fetch()`.

**Quantified request volume:**

| Scenario | Requests |
|----------|---------|
| 6 players × 1 poll/s × 5-min lobby | 1,800 |
| 6 players × 1 poll/s × 2-min round × 3 rounds | 2,160 |
| 6 players × 1 poll/s × 1-min reveal × 3 rounds | 1,080 |
| **Total per session** | **~5,040** |

| Sessions/day | Requests/month | Beyond 2M free | Monthly cost |
|-------------|---------------|---------------|-------------|
| 30 | ~3.9M | ~1.9M | ~$0.76 |
| 100 | ~13M | ~11M | ~$4.40 |
| 300 | ~39M | ~37M | ~$14.80 ❌ over budget |

Source for free tier and per-request pricing: [https://learn.microsoft.com/en-us/azure/container-apps/billing](https://learn.microsoft.com/en-us/azure/container-apps/billing). At 2-second polling, all figures halve. **At the expected scale of an invite-only word game (under 100 sessions/day), polling fits comfortably within the $10/month budget alongside compute and AI costs.**

**HTTP scaling rule interaction:** ACA's default HTTP scale rule fires at 10 concurrent requests per 15-second window ([https://learn.microsoft.com/en-us/azure/container-apps/scale-app](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)). At 30 sessions/day with sessions spread across hours, concurrent room polls are unlikely to reach 10 at the same time. Polling will not trigger unexpected scale-out in normal conditions. A lobby of 6 players polling at 1/s = 6 concurrent requests, which is under the default threshold.

---

### Option E: Azure Web PubSub

**Architecture:** Browsers connect directly to the Web PubSub service endpoint over WebSocket, not to the app server. The app server broadcasts events by calling the `@azure/web-pubsub` REST API. No WebSocket server in the app process; no `'upgrade'` event interaction with Vite HMR.

**Multiple replicas:** ✅ **Solved by design.** All app replicas call `serviceClient.group('room:xyz').sendToAll(msg)`. Web PubSub fans it out to all connected browsers regardless of which replica they came from. The service IS the backplane.

**Scale-to-zero:** ✅ Client WebSocket connections are held by Web PubSub, not by a replica. Replicas can scale to zero; browsers stay connected to the Web PubSub endpoint.

**Managed identity:** ✅ Supported. The server uses `DefaultAzureCredential` to authenticate to Web PubSub — exactly the same pattern already used for Blob Storage and Foundry. Source: [https://learn.microsoft.com/en-us/azure/azure-web-pubsub/howto-use-managed-identity](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/howto-use-managed-identity). The server calls `serviceClient.getClientAccessToken()` to issue a JWT to each browser for its direct WebSocket connection to the service.

**Reconnection:** ✅ Web PubSub client SDK handles reconnection.

**Browser support:** ✅ Standard WebSocket. Browsers connect to `wss://<service>.webpubsub.azure.com/client/hubs/<hub>?access_token=<jwt>`.

**Dependency:** `@azure/web-pubsub` (~200KB installed, all JS, no native deps). Source: [https://learn.microsoft.com/en-us/azure/azure-web-pubsub/reference-server-sdk-js](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/reference-server-sdk-js)

**esbuild bundling:** ✅ External. No issues.

**Testability in Vitest:** ⚠️ Server-side SDK calls are testable by injecting a mock `WebPubSubServiceClient`. End-to-end testing (browser WebSocket connecting to the service) requires a real Web PubSub instance or a local emulator. No community-maintained local emulator exists as of this research.

**Cost:** Source: [https://learn.microsoft.com/en-us/azure/azure-web-pubsub/concept-billing-model](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/concept-billing-model)
- Free tier: 20,000 messages/day, 20 concurrent connections. One 6-player session would exceed 20 concurrent connections.
- Standard tier: billed per unit (1 unit = 1,000 max concurrent connections) per day. ~$0.33/unit/day = ~$10/month for 1 unit.
- **One Standard unit costs approximately as much as the entire monthly budget.** Web PubSub is incompatible with the current $10/month constraint.

---

## Q3 — esbuild bundling analysis

**Build command** (from `package.json`, verified): `esbuild src/server/main.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs`

**`--packages=external` is the key flag.** Every import from `node_modules` becomes a `require()` call in the output file rather than being inlined. This means:

- No npm package code is ever seen by esbuild's bundler.
- Native binary dependencies, optional deps, dynamic requires inside npm packages — none of these are a build concern.
- They are a **runtime** concern: the container image must have the packages installed.

**Per-option verdict:**

| Option | Package to add | esbuild concern | Runtime concern |
|--------|---------------|-----------------|----------------|
| `ws` | Add `ws` to `dependencies` | ✅ None — external | `bufferutil`: optional, falls back to JS if absent. `utf-8-validate`: irrelevant on Node ≥ 22. |
| `socket.io` | Add `socket.io` to `dependencies` | ✅ None — external | 21 packages, all JS (except the optional native deps ws brings in). |
| SSE | None | ✅ None | — |
| HTTP polling | None | ✅ None | — |
| `@azure/web-pubsub` | Add `@azure/web-pubsub` to `dependencies` | ✅ None — external | All JS, no native deps. |

**`bufferutil` specifically:** declared as `optionalDependencies` in ws's package.json. If not installed, ws catches the import error and falls back to pure JS ([https://github.com/websockets/ws/blob/master/README.md](https://github.com/websockets/ws/blob/master/README.md)). The performance difference for ≤ 10 players sending short JSON messages is unmeasurable. Do not install it. **`utf-8-validate`** is only useful on Node < 18.14.0; this repo requires ≥ 22.12.0, so it is never used regardless of whether it is installed.

**If esbuild ever stops being called with `--packages=external`** (e.g., someone removes that flag), ws would fail to bundle due to its optional native dep dynamic requires. The fix is simple: add `--external:bufferutil --external:utf-8-validate` to the esbuild command. This is documented in the ws README. But with the current build command, this issue cannot arise.

---

## Q4 — Azure Container Apps ingress

### WebSocket support

✅ **Explicitly confirmed.** From the ACA ingress overview, HTTP ingress protocol support ([https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview), updated 2026-08-05):

> "Support for TLS termination; Support for HTTP/1.1 and HTTP/2; **Support for WebSocket and gRPC**"

No special configuration is required to enable WebSocket support. The existing HTTP ingress configuration works as-is.

### SSE support

✅ SSE is a standard HTTP response (`Content-Type: text/event-stream`). ACA HTTP ingress routes it normally. The only concern is the idle timeout, addressed below.

### Request timeout

**240 seconds** — documented in the ingress overview ([https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)):

> "Request time out is 240 seconds"

This applies to HTTP requests, including SSE responses (which are long-lived HTTP responses). **WebSocket connections, once upgraded, are raw TCP streams — they are no longer HTTP requests.** The 240-second limit technically applies to the upgrade handshake, not the ongoing connection. However, the ingress layer may enforce an **idle connection timeout** for upgraded WebSocket connections that is not separately documented. Treat 240 seconds as a conservative upper bound for idle WebSocket connections too. Mitigation: application-level pings every 30 seconds (WebSocket `ping`/`pong` frames or SSE comment heartbeats).

### Scale-in and SIGTERM

When a replica is scaled in or a new revision is deployed, Container Apps sends SIGTERM to the process ([https://learn.microsoft.com/en-us/azure/container-apps/revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions)). The existing shutdown handler in `main.ts` calls `server.close()` and forces exit after 10 seconds. **`server.closeAllConnections()` does NOT close WebSocket connections** (Node.js docs: "This does not destroy sockets upgraded to a different protocol, such as WebSocket or HTTP/2" — [https://nodejs.org/api/http.html#servercloseallconnections](https://nodejs.org/api/http.html#servercloseallconnections)). Any WebSocket server must be explicitly closed in the shutdown callback:

```typescript
// Required addition to existing shutdown handler:
server.close(async () => {
  appWss.clients.forEach(ws => ws.close(1001, 'Server shutting down'));
  appWss.close();
  await flushTelemetry();
  process.exit(0);
});
```

Close code 1001 ("Going Away") is the correct WebSocket close code for a server shutting down. Browsers receive this and trigger reconnection logic.

### Session affinity

ACA supports sticky sessions via cookie-based routing ([https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions](https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions)). Session affinity routes all requests from a given browser to the same replica. This helps WebSocket connections stay on one replica but **does not solve cross-replica fan-out**: player A sticks to replica 1 and player B sticks to replica 2; they are still isolated. Sticky sessions reduce the frequency of the problem but do not eliminate it. A backplane or Web PubSub is still required for correctness.

---

## Q5 — Testability under Vitest

Vitest is configured with `environment: 'node'`, no Vite plugins, no browser context (`vitest.config.ts`, verified). The constraint is: tests must run with `vitest run` from the command line, in Node, without a browser.

| Option | Vitest testable | Setup required | Notes |
|--------|----------------|----------------|-------|
| `ws` (noServer) | ✅ Easy | `http.createServer()` + `WebSocketServer({noServer:true})` + manual upgrade handler + `ws` client | Best option for testing the upgrade routing logic |
| `socket.io` | ✅ Moderate | `new Server(httpServer)` + `io.connect()` from `socket.io-client`; use `transports:['websocket']` | Extra package needed in devDeps |
| SSE | ✅ Easiest | `http.get()` or `fetch()` to GET the SSE endpoint; read body as text stream | No WebSocket client needed; simplest setup |
| HTTP polling | ✅ Trivial | Standard `fetch()` or `http.get()` | Identical to existing API tests |
| Azure Web PubSub | ⚠️ Partial | Server SDK calls testable with `jest.fn()` / `vi.fn()` mock of `WebPubSubServiceClient` | End-to-end WebSocket path cannot be tested without real service |

**Design recommendation for all options:** Wrap the broadcast logic behind a `RoomBroadcaster` interface:

```typescript
// shared or server/rooms/broadcaster.ts
export interface RoomBroadcaster {
  send(roomId: string, event: RoomEvent): Promise<void>;
}
```

In tests, inject a mock. Integration tests use a real `http.Server` with the ws server attached, listened on `port: 0`. This is the same seam design as `DailyChallengeStore` and already fits the project's conventions.

---

## Q6 — The polling baseline (honest assessment)

**What polling delivers for free:**

- Zero new dependencies
- Zero upgrade-event complexity (no Vite HMR interaction)
- Zero backplane requirement (state reads from the shared store every replica already uses)
- Trivial testability
- Universal browser support
- Works correctly through scale-to-zero cold starts (the cold start is ~760–960 ms per DEPLOYED.md; a poll during cold start waits, then returns)
- Implicit reconnection on every request

**What polling cannot do:**

- **Instant push.** Worst-case latency = 1 poll interval (1–2 seconds). Average latency = half the poll interval.
- **Instant disconnect detection.** Must wait 3–10 seconds (3–5 missed polls) to infer a disconnect. Tab-closed detection is inherently delayed.
- **Sub-second event delivery.** The round-start moment, in particular, will be received up to 1 second late by some players.

**The game protocol question:** For a word game where each player submits when ready (current architecture: client-side timer, `timeTakenSeconds` in the submission), is sub-second event delivery required?

- **Round start notification:** 0–1 second latency for all players to know the round started. Probably acceptable for a casual game; no competitive rating depends on the start moment.
- **Player joined / left:** 0–2 second latency to show the lobby roster updating. Fine.
- **Scores revealed:** Server writes scores; players poll and see them within 1 second. Fine.
- **Disconnect detection:** Server knows a player left within 3–10 seconds. For the lobby, fine. For a mid-round abandonment, the game would likely continue anyway (as specified: the round continues until all connected players submit or time out).

**Verdict on polling for v1:** Polling beats WebSocket and SSE on the dimensions that matter most for a spec (simplicity, zero new infrastructure, natural multi-replica compatibility). The latency limitation is real but not a blocker for this game's protocol. The request cost is within the budget at expected scale. **Polling is a rational first implementation that can be upgraded to SSE or WebSocket without any change to the room state store or the client-server protocol — only the delivery mechanism changes.** The spec should name polling as the v1 transport with a clear upgrade path to SSE or WebSocket as a later improvement.

---

## Comparison table

| | Raw `ws` | `socket.io` | SSE | HTTP polling | Azure Web PubSub |
|--|--|--|--|--|--|
| **Vite HMR coexistence** | ✅ Path-route on 'upgrade' | ✅ Same (engine.io) | ✅ No upgrade needed | ✅ No upgrade needed | ✅ No app WS |
| **Multi-replica** | ❌ Needs Redis backplane | ❌ Needs Redis adapter | ❌ Needs backplane | ✅ Shared state store | ✅ Solved by service |
| **Client reconnection** | ❌ Manual (~15 lines) | ✅ Built-in | ✅ EventSource built-in | ✅ Implicit | ✅ SDK built-in |
| **Disconnect detection** | ✅ Instant (WS close) | ✅ Instant | ✅ Server `close` event | ⚠️ 3–10 s timeout | ✅ Instant |
| **Direction** | ↔️ Bidirectional | ↔️ Bidirectional | ⬇️ Server→client only | ↔️ Via separate POSTs | ↔️ Bidirectional |
| **Browser support** | ✅ All modern | ✅ All modern | ✅ All modern | ✅ Universal | ✅ All modern |
| **New npm packages** | 1 (`ws`) | ~21 | 0 | 0 | 1 (`@azure/web-pubsub`) |
| **esbuild bundling** | ✅ External (no issue) | ✅ External | ✅ N/A | ✅ N/A | ✅ External |
| **Vitest testable** | ✅ Easy | ✅ Moderate | ✅ Easiest | ✅ Trivial | ⚠️ Mock only |
| **ACA WebSocket support** | ✅ Confirmed | ✅ Confirmed | ✅ Plain HTTP | ✅ Plain HTTP | ✅ Browsers→service |
| **ACA 240s timeout** | ✅ WS bypasses limit | ✅ WS bypasses limit | ⚠️ Heartbeat required | ✅ Short requests | ✅ N/A |
| **SIGTERM handling** | ⚠️ Must close `wss` explicitly | ⚠️ Must close explicitly | ✅ Streams close naturally | ✅ N/A | ✅ N/A |
| **Monthly infra cost** | Redis ~$16+/month | Redis ~$16+/month | Redis ~$16+/month | None | ~$10/month (Standard) |
| **New infrastructure** | Redis or Service Bus | Redis or Service Bus | Redis or Service Bus | None | Web PubSub instance |
| **Spec complexity** | Moderate | Moderate | Low–moderate | Low | Moderate |

---

## Ranked recommendation

These are ranked by fit for the current constraints: $10/month budget, single-process server, no existing backplane, Vitest test discipline, and the goal of producing a reviewed spec rather than an immediate implementation.

### Rank 1 — HTTP polling (v1 spec)

**Start here.** Zero new dependencies, zero new infrastructure, the only transport that naturally survives multiple replicas without a backplane. The latency (1–2 seconds) is acceptable for a lobby-based word game. Cost is within budget at expected scale (under 100 sessions/day). Spec complexity is lowest. Upgrade path to SSE or WebSocket is straightforward and does not require changes to the room state design.

**Accept these tradeoffs:** No instant disconnect detection; 1–2s push latency; request charges at scale.

---

### Rank 2 — SSE over Express (v1 or v1.1)

**Strong alternative, especially if instant push is in scope for v1.** Zero new npm packages. No Vite HMR collision. `EventSource` auto-reconnects in the browser. Server-to-client push is instant. The 240-second timeout is mitigated by a 30-second heartbeat comment (2 lines of code). Client-to-server messages remain HTTP POST — already the app's pattern.

**The one remaining blocker:** A pub/sub backplane is required for cross-replica fan-out. The spec must choose and provision one (Redis, Azure Service Bus) before SSE can be recommended for production. This backplane will also be needed by raw WebSocket, so it is not SSE-specific overhead.

**Accept these tradeoffs:** Backplane needed; server-to-client only (bidirectionality via POST); can't detect mid-round disconnect without a `close` event handler.

---

### Rank 3 — Raw `ws` WebSocket

**Use when bidirectional, low-latency, and instant disconnect detection are all required.** The upgrade coexistence problem is solved (verified from Vite source). The `noServer + path-routing` pattern is clean and well-documented. ws is already in the dependency graph (as Vite's dep); adding it as a direct dep is one line in `package.json`.

**Accept these tradeoffs:** Manual client reconnection; backplane required (same as SSE); explicit WS server shutdown in SIGTERM handler required; `server.closeAllConnections()` does not close WS connections (must call `wss.close()` separately).

---

### Rank 4 — `socket.io`

**Only if the team values the batteries-included bundle** (reconnection + Redis adapter + rooms/namespaces API). For a codebase that already uses thin port abstractions and custom adapters, socket.io's higher-level abstractions compete with rather than complement the design. The engine.io HTTP polling fallback adds request noise unless disabled. For this use case, raw ws + manual reconnection is leaner.

**Accept these tradeoffs:** 21 packages; HTTP polling fallback on initial connect (disable with `transports: ['websocket']`); Redis adapter does not support connection state recovery; same backplane requirement as raw ws.

---

### Rank 5 — Azure Web PubSub

**Architecturally the right long-term answer; wrong for the current budget.** Eliminates the backplane problem, integrates with managed identity, scales to 1 million connections, requires no WebSocket management in the app process. Revisit when either (a) the budget is raised above $20/month or (b) the game demonstrates an active user base that makes the backplane complexity of Redis worth trading for the simplicity of a managed service.

**Do not provision now.** The Free tier (20 connections, 20K messages/day) is too small for even a single active room. Standard tier (~$10/month for 1 unit) consumes the entire budget before any other cost is counted.

---

## Source index

| Claim | Primary source |
|-------|---------------|
| Vite HMR WS implementation, `noServer` mode, `'upgrade'` listener | `vitejs/vite:packages/vite/src/node/server/ws.ts` SHA `733059ef` |
| ws `noServer` + multiple WS servers pattern | https://github.com/websockets/ws/blob/master/README.md#multiple-servers-sharing-a-single-https-server |
| ws optional native deps (`bufferutil`, `utf-8-validate`) | https://github.com/websockets/ws/blob/master/README.md |
| Node.js `'upgrade'` event: semantics, auto-destroy behaviour | https://nodejs.org/api/http.html#event-upgrade-1 |
| Node.js `server.closeAllConnections()` excludes WS | https://nodejs.org/api/http.html#servercloseallconnections |
| ACA HTTP ingress: WebSocket + gRPC explicitly supported | https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview |
| ACA HTTP ingress: 240-second request timeout | https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview |
| ACA session affinity (sticky sessions) | https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions |
| ACA HTTP scale rule: default 10 concurrent requests | https://learn.microsoft.com/en-us/azure/container-apps/scale-app |
| ACA billing: 2M free HTTP requests/month, per-request rate | https://learn.microsoft.com/en-us/azure/container-apps/billing |
| ACA revision lifecycle, SIGTERM on scale-in | https://learn.microsoft.com/en-us/azure/container-apps/revisions |
| socket.io dependency tree (21 packages, ws 8.17.x) | https://socket.io/docs/v4/server-installation/#dependency-tree |
| socket.io Redis adapter; no connection state recovery | https://socket.io/docs/v4/redis-adapter/ |
| Azure Web PubSub overview; multiplayer games use case | https://learn.microsoft.com/en-us/azure/azure-web-pubsub/overview |
| Web PubSub managed identity | https://learn.microsoft.com/en-us/azure/azure-web-pubsub/howto-use-managed-identity |
| Web PubSub billing model (units, message count, free quota) | https://learn.microsoft.com/en-us/azure/azure-web-pubsub/concept-billing-model |
| Web PubSub JS server SDK | https://learn.microsoft.com/en-us/azure/azure-web-pubsub/reference-server-sdk-js |
| `EventSource` browser API (SSE) | https://developer.mozilla.org/en-US/docs/Web/API/EventSource |
| `WebSocket` browser API | https://developer.mozilla.org/en-US/docs/Web/API/WebSocket |
| Vite installed version (local) | `node_modules/vite/package.json` (viewed) — `6.4.3` |
| esbuild `--packages=external` in build command (local) | `package.json` `scripts.build` (viewed) |
| SIGTERM handler, `server.close()` pattern (local) | `src/server/main.ts` (viewed) |
