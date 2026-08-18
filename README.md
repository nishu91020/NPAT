# Letters Daily — Name, Place, Animal, Thing

A daily word puzzle. Each day gives you one letter; fill in a Name, a Place, an Animal and a Thing
before the timer runs out. Answers are judged by an AI referee, with a local heuristic as a fallback.
There is also a multiplayer mode where up to eight players race the same letter in a room.

**Design and architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Originally scaffolded in Google AI Studio:
https://ai.studio/apps/3215f559-5d19-4a45-b6e1-bdb2a4673ed4

## Run locally

**Prerequisites:** Node.js

1. Install dependencies:

   ```
   npm install
   ```

2. *(Optional)* Configure AI judging. Without this the app runs on the heuristic judge, which is a
   supported mode — the game is fully playable, just with simpler rulings.

   Copy `.env.example` to `.env` and fill in your Microsoft Foundry endpoint and deployment names.
   There is no API key: authentication is Microsoft Entra ID, so sign in with

   ```
   az login
   ```

   The signed-in identity needs the *Cognitive Services OpenAI User* role on the resource. Setting
   only some of the three variables is a startup error rather than a silent downgrade.

3. Run the app:

   ```
   npm run dev
   ```

## Scripts

| | |
|---|---|
| `npm run dev` | Express + Vite middleware on http://localhost:3000 |
| `npm test` | Vitest |
| `npm run lint` | TypeScript typecheck |
| `npm run build` | Production build (client + bundled server) |
| `npm start` | Run the production build (set `NODE_ENV=production`) |
