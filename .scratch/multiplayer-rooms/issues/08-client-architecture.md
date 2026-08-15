# Where do invite links live in a client with no router?

Type: grilling
Status: open
Blocked by: 01, 07

## Question

"Invite others" is the requirement that breaks a standing convention. This app has **no router**:
one page, one URL, and every piece of state in `App.tsx` passed down as props, with
`client/components/` holding presentational components only. An invite link needs a URL that means
"this room".

Decide:

- **How a room appears in the URL** — a real path (`/room/ABCD`), a hash (`#/room/ABCD`), or a query
  parameter (`/?room=ABCD`). Note the production server already has an `app.get('*')` SPA fallback,
  so a real path costs nothing on the server; the cost is on the client.
- **Whether a router is added, and if so which** — or whether one route is cheap enough to read off
  `window.location` by hand. Adding a router is a permanent change to how this codebase is written,
  so it deserves a decision rather than an import.
- **Where room state lives in the client.** `App.tsx` currently holds every piece of state. Room
  state is bigger, arrives asynchronously from elsewhere, and is read by components several levels
  down. Decide whether it stays in `App.tsx`, moves to a reducer, or gets a context — and whether
  that reopens the "no state library" convention.
- **What a visitor to a room URL sees before they have a name** — and whether an unknown or expired
  room code shows an error, redirects to the daily, or offers to create that room.
- **Where the live connection is owned** (a hook? a module like `audio.ts` that owns its own state?)
  and how components consume it without every one of them knowing about sockets. Note the precedent
  the codebase already sets with muting: the concern was pulled *into* the module so eighteen call
  sites could not each forget it.
- **What of this crosses the tier seam.** Room and player shapes that both tiers agree on belong in
  `src/shared/contract.ts`; anything else stays in `client/types.ts`. `client/` must never import
  from `server/`.
