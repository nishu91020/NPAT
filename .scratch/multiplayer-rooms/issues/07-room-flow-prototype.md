# What does the room flow look like on screen?

Type: prototype
Status: open
Blocked by: 01, 04

## Question

Discussing rooms in prose has a ceiling. Build a cheap, throwaway prototype of the whole flow so
there is something concrete to react to, and link it from this ticket rather than pasting it in.

Use the `/prototype` skill. The flow to cover, end to end:

1. Landing — how a player who wants to play with friends finds the door, next to the daily puzzle
   that is the app's front page today.
2. Entering a display name.
3. Create a room, or join one by code.
4. The lobby — who is here, who is the host, the invite affordance, and how a round begins.
5. The round itself — what `CategoryInputForm` gains: other players' presence, who has submitted,
   the shared clock (if the round shape has one).
6. The wait while the room is judged — up to several seconds of dead air per player.
7. The reveal — everyone's answers, the scores, the leaderboard, and where a "duplicate answer"
   penalty would be shown if there is one.
8. What happens next — rematch, leave, back to the daily.

Constraints worth honouring even in a throwaway, because they are what the real thing must look
like: the flat geometric language (square corners, `border-2` / `border-l-4` accents, hard offset
shadows, `text-[10px] font-black uppercase tracking-widest` micro-labels, `min-h-[48px]` touch
targets, slate / `indigo-600` / rose / emerald / amber, `lucide-react` icons only).

The point is to answer "how should it feel", and to surface the states nobody thinks about until
they see the screen: the room of one, the player who never submits, the judged round where two
people wrote the same word.
