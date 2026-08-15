# How does realtime transport fit this server?

Type: research
Status: resolved

## Question

If players in a room have to see each other appear, start, and finish, something has to push updates
to the browser. This repo has an unusually opinionated server to fit that into, so the question is
not "which library is popular" but "what survives contact with *this* process".

The constraints to check each option against:

- **One process, one port.** `src/server/main.ts` is both tiers. In development it mounts
  `vite.middlewares` in `middlewareMode`; in production it serves static `dist/` with an
  `app.get('*')` SPA fallback. There is no separate dev server and no proxy config.
- ⚠️ **Vite's dev server already owns a WebSocket** — HMR. Find out exactly how an `upgrade` handler
  for an application WebSocket coexists with Vite's in `middlewareMode`: does Vite attach to the
  HTTP server, does it need `server.hmr.server`, and how do two upgrade listeners share one port
  without stealing each other's connections? This is the highest-risk unknown in the ticket.
- **The production bundle is esbuild**, `src/server/main.ts` → `dist/server.cjs`. Check that each
  candidate bundles as CJS without native or dynamic-require surprises.
- **Ingress.** Does Azure Container Apps ingress support WebSockets and Server-Sent Events, and what
  are the documented idle/connection timeouts? A round can sit in a lobby for minutes.
- **Tests.** Vitest runs against a deliberately plugin-free `vitest.config.ts` in a node
  environment. Which options are testable there without standing up a real server?

Compare at least: raw `ws`, `socket.io`, Server-Sent Events over plain Express, plain HTTP polling,
and Azure Web PubSub (which moves the sockets out of the process entirely — note how that interacts
with scale-to-zero and with managed-identity auth).

For each, report: how it attaches to an existing Express + `http.Server`, its behaviour across
multiple replicas (a socket on replica A cannot see an event on replica B without a backplane — say
what backplane each needs), reconnection support, browser support, and bundle/dependency weight.

Also confirm the low-tech baseline honestly: **how far does polling get?** A room of six polling
every second is a real option and needs beating on evidence, not taste.

## Context

Findings land at [research/03-realtime-transport.md](../research/03-realtime-transport.md), written
by a `/research` subagent fired when this map was charted.

## Answer

**Full findings: [research/03-realtime-transport.md](../research/03-realtime-transport.md).**

⚠️ **The headline is that the highest-risk unknown turned out not to exist.** The subagent
concluded from the Vite source that Vite attaches its HMR WebSocket to the app's `http.Server`, so
an application WebSocket would have to share the `'upgrade'` event with it. **That is wrong for
this repo, and it was caught by running the dev server and looking:**

```
LocalPort OwningProcess
    24678         21924   <- Vite HMR, on its own http.Server
     3000         21924   <- Express
```

In `middlewareMode` Vite creates no HTTP server of its own to pass in, and `vite.config.ts` sets
neither `server.hmr.server` nor `server.hmr.port` — so Vite's `wsServer` resolves falsy and it
stands up a **separate** server on the default HMR port 24678. It never registers an `'upgrade'`
listener on the Express server, so port 3000's upgrade path is uncontended. Production never
imports Vite at all. This is contingent on `hmr.server` staying unset, so it should be **pinned by
a test** rather than trusted across a Vite upgrade. (Verified against the installed Vite 6.4.3, not
just the GitHub source.)

The rest, from primary sources:

- **Container Apps supports both WebSocket and SSE**, with a 240-second ingress timeout that
  WebSocket connections bypass once upgraded and SSE needs a ~30 s heartbeat comment to survive.
- **Nothing bundles badly.** The build passes `--packages=external`, so no dependency is bundled at
  all and `ws`'s optional native deps are irrelevant.
- ⚠️ **`server.close()` does not close upgraded WebSockets.** The existing SIGTERM handler would
  leave sockets open; a WS server has to be closed explicitly. This matters because the graceful
  shutdown exists precisely so a player's in-flight round is not dropped.
- **Every option except Azure Web PubSub needs a cross-replica backplane** — a socket on replica A
  cannot see an event on replica B. Web PubSub removes that problem and costs ~$49/month, which is
  five times the budget.
- **Polling is a genuine contender, not a booby prize.** It is the only transport that survives
  multiple replicas with no backplane at all, because the shared store is already the source of
  truth. Costed at under ~$4.40/month at small scale, and by far the easiest to test under Vitest.
- **Recommended ranking:** polling for a first version, SSE or raw `ws` next (SSE needs no upgrade
  handling and `EventSource` reconnects by itself), Web PubSub only if the budget grows.
