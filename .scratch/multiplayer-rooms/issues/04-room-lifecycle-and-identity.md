# How is a room created, joined, invited to, and ended?

Type: grilling
Status: open
Blocked by: 01

## Question

The user's request names three acts: **enter a name**, **create or join a room**, **invite others**.
This ticket pins down what each one actually is.

Decide:

- **The room code.** Its alphabet and length, and therefore its collision odds and its guessability.
  These are the same knob: a 4-character code is pleasant to read down a phone line and also
  brute-forceable by a stranger. Decide whether an uninvited guesser landing in a room matters —
  and note the room code is the *only* access control, since there are no accounts.
- **The invite.** A copyable link, a code read aloud, or both. A link means a URL that carries the
  room, which is what forces the routing question in
  [Where do invite links live in a client with no router?](08-client-architecture.md).
- **The display name.** Where it is entered, whether it persists in `localStorage` alongside the
  existing `npat_*_v1` keys, what happens when two players in a room pick the same name, and what
  the limits are (length, characters, emoji).
- **Player identity within a room.** With no accounts, what makes a returning browser the *same*
  player rather than a second one — a per-tab id, a persisted client id, or nothing at all? This is
  what decides whether refreshing the page mid-round loses your seat, and whether one person can
  join their own room twice to inflate a leaderboard.
- **The host.** Does one exist, what can only they do, and what happens when they leave.
- **Capacity and lifetime.** Maximum players, what a full room says, when a room dies (idle timeout,
  round finished, everyone left) and who cleans it up — remembering the app scales to zero, so there
  is no reliable background sweeper unless one is designed.
- **Joining late.** Can someone enter a room while a round is running, and if so do they watch, wait,
  or play a short round?

The answers to capacity, lifetime, and cleanup are also the inputs the storage decision needs, so
prefer concrete numbers over "some" and "eventually".

## Input from the prototype

⚠️ **A room must not close the instant its last player leaves.** The state-machine prototype
([prototype/room-state.html](../prototype/room-state.html), walkthrough *"The solo host refreshes
the page"*) was written that way and immediately produced an absurdity: a player alone in their own
room who presses F5 **destroys it**, because a refresh and a departure are indistinguishable to the
server. The prototype now empties a room into a grace period (120 s as a placeholder) and closes it
only if nobody returns; a reconnecting client reclaims both its seat *and* the host role if the room
lost its host meanwhile.

That makes three numbers this ticket has to name rather than assume: the **grace period** before an
empty room closes, the **reconnect window** in which a returning client is the same player, and
**what drives the clock** that closes the room — since the app scales to zero, nothing sweeps
expired rooms unless it is designed, and the cheapest answer is that rooms expire lazily on next
read rather than being reaped.
