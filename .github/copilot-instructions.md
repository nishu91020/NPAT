# Copilot Instructions — Letters Daily (NPAT)

Daily "Name, Place, Animal, Thing" word puzzle. React 19 + Vite 6 + Tailwind v4 frontend served by an
Express server that also proxies answer validation to the Gemini API.

## Commands

```bash
npm install
npm run dev      # tsx server.ts — Express + Vite middleware on http://localhost:3000
npm run lint     # tsc --noEmit
npm test         # vitest run
npm run test:watch
npm run build    # vite build -> dist/, then esbuild bundles server.ts -> dist/server.cjs
npm start        # node dist/server.cjs (requires NODE_ENV=production to serve dist/)
```

Tests are Vitest, configured by `vitest.config.ts` — a **separate, deliberately plugin-free config**. Do
not point Vitest at `vite.config.ts`: loading `@tailwindcss/vite` fails in Vitest's node environment.
Run a single file or test with:

```bash
npx vitest run server/referee/scoring.test.ts
npx vitest run -t "awards each tier at its boundary"
```

To exercise an endpoint by hand while `npm run dev` is running:

```bash
curl "http://localhost:3000/api/health"
curl "http://localhost:3000/api/daily-challenge?date=2026-08-08"
curl -X POST "http://localhost:3000/api/validate" -H "Content-Type: application/json" \
  -d '{"letter":"I","answers":{"name":"Ivan","place":"India","animal":"Iguana","thing":"Ice"},"bonusChallenge":{"id":"long_words","title":"t","description":"d","icon":"Sparkles","ruleHint":"r"},"timeTakenSeconds":18}'
```

`GEMINI_API_KEY` goes in `.env` (gitignored). It is **optional** — every AI path has a local fallback, so
always verify changes work both with and without the key. Note that `npm start` still runs the Vite dev
middleware unless `NODE_ENV=production` is set, and `npm run clean` is Unix-only (`rm -rf`).

## Architecture

**One process, one port.** `server.ts` is the entry point for both tiers. In development it imports Vite
and mounts `vite.middlewares` in `middlewareMode`; in production (`NODE_ENV=production`) it serves static
`dist/` with an `app.get('*')` SPA fallback. There is no separate Vite dev server and no proxy config —
that is why the client can `fetch('/api/...')` with relative URLs.

**`src/` is the client, `server/` is server-only.** `server.ts` stays at the repo root as the esbuild
entry, and imports `server/referee/` and `server/bonus/`. Nothing under `server/` may be imported from
`src/` — that is what keeps the Gemini SDK and the prompts out of the browser bundle. `src/utils/
puzzleData.ts` is the one genuinely shared module (both tiers call `getDailyPuzzleData`), so keep it
isomorphic: no `window`, no `localStorage`, no Node built-ins.

**Scoring is server-only and lives in exactly one place.** `server/referee/scoring.ts` owns the `SCORING`
constants, the speed ladder, the points mapping, and the totals. Judges never assign points and never see
the clock — `JudgeRequest` deliberately omits `timeTakenSeconds`. Two adapters satisfy the `Judge` seam:
`createGeminiJudge` and `heuristicJudge`, composed by `withFallback`. To change how a round scores, edit
`SCORING`; to change how words are judged, edit an adapter.

**The heuristic judge only claims what it can verify.** It awards `long_words` and `vowel_rich` because
those are checkable from the word alone, and declines the five knowledge-based challenges rather than
guessing. It is a degraded mode — it runs when `GEMINI_API_KEY` is missing or Gemini fails — so scores
are legitimately lower than an AI-judged round. `judgedBy` on the response records which one ruled.

**Puzzle generation is deterministic, not stored.** `getDailyPuzzleData(dateStr)` hashes the `YYYY-MM-DD`
string to pick a letter from `AVAILABLE_LETTERS` (Q/U/X/Y/Z are deliberately excluded) and a bonus
challenge, and derives `dayNumber` from a `2026-01-01` epoch. There is no database. Changing the hash,
the letter list, or the epoch retroactively rewrites every past puzzle — treat those as frozen constants.

**The daily bonus is generated once per date.** `cachedPerDate` in `server/bonus/types.ts` caches the
in-flight promise per date so every player gets the same challenge and a refresh does not reroll it,
falling back to the deterministic challenge. Practice mode is intentionally random per request.

**Scoring failure is not silently faked.** The client has no local validator. If `/api/validate` fails,
`App.tsx` shows an error and does **not** record the round, so streak stats cannot be corrupted by a
guess. The puzzle *fetch* still falls back to `getDailyPuzzleData` so the letter renders offline.

**Gemini usage.** Both AI calls use model `gemini-3.6-flash` with `responseMimeType: 'application/json'`
plus an explicit `responseSchema` built from the `Type` enum. New AI endpoints should follow that pattern
rather than parsing free-form text.

**State and persistence.** No router and no state library. All game state lives in `App.tsx` and is passed
down as props; `src/components/` holds presentational components only. Persistence is `localStorage` via
`src/utils/storage.ts` under versioned keys `npat_game_stats_v1` / `npat_today_result_v1` — bump the `_v1`
suffix when the stored shape changes, since loaders only shallow-merge over `DEFAULT_STATS`.

**Audio is synthesized, not loaded.** `src/utils/audio.ts` generates every sound with the Web Audio API
through a lazily-created shared `AudioContext`. There are no audio assets. Every function no-ops when the
context is unavailable and swallows errors, because browsers block audio before user interaction.

## Conventions and gotchas

- **Both Gemini adapters take an injected client.** `createGeminiJudge(ai)` and
  `createGeminiBonusSource(ai)` accept a `GoogleGenAI` rather than constructing one, which is what makes
  them testable — see the fake client in `server/referee/geminiJudge.test.ts`. Both use
  `responseMimeType: 'application/json'` with an explicit `responseSchema`; follow that pattern rather
  than parsing free-form text, and throw on a malformed response so `withFallback` engages.
- **Bonus challenge icons are constrained at the source.** `RENDERABLE_ICONS` in
  `server/bonus/geminiSource.ts` is the list offered to the model *and* the clamp applied to its answer.
  It must stay in lockstep with `ICON_MAP` in `LetterBanner.tsx`; adding an icon means editing both.
- **Streak math exists twice**: `App.tsx#handleSubmitAnswers` computes a streak for the result object,
  while `storage.ts#recordGameCompletion` independently recomputes the persisted value. Update both.
- **`judgedBy` is the provenance field.** It is typed in `src/types.ts` and optional there only so
  rounds persisted before it existed still parse. `ValidationResultCard` shows the "Gemini AI Referee"
  badge on `=== 'gemini'`; do not weaken that to a truthiness check.
- **Types are centralized** in `src/types.ts` (`CategoryKey`, `DailyPuzzle`, `GameResult`, `GameStats`,
  `JudgedBy`, …). Components define their own local `...Props` interface and are typed `React.FC<Props>`
  with named exports; only `App.tsx` uses a default export.
- **Tailwind v4, CSS-first.** Wired through the `@tailwindcss/vite` plugin with a single
  `@import "tailwindcss";` in `src/index.css`. There is no `tailwind.config.js` — do not add one; extend
  via CSS. Styling is inline utility classes; there are no CSS modules or styled components.
- **Design language is deliberately flat and geometric**: square corners (no `rounded-*`), `border-2` /
  `border-l-4` accent rules, hard offset shadows like `shadow-[6px_6px_0px_0px_rgba(0,0,0,0.1)]`,
  `text-[10px] font-black uppercase tracking-widest` micro-labels, `min-h-[48px]` touch targets, and a
  slate/`indigo-600`/rose/emerald/amber palette. All icons come from `lucide-react`.
- **`playClickSound()` is called unconditionally** in components, while `playTickSound` and the win/lose
  sounds are gated on the `soundEnabled` prop. Match the surrounding call site rather than assuming a gate.
- **The `@` alias** maps to the repo root in both `tsconfig.json` and `vite.config.ts`, but nothing uses it;
  existing code imports relatively (`../utils/audio`).
- **Do not change the HMR block in `vite.config.ts`.** It is driven by the `DISABLE_HMR` env var so AI Studio
  can disable file watching during agent edits, and it carries an explicit "do not modify" comment.
- **Gemini usage.** Both AI calls live behind ports in `server/`. `GEMINI_API_KEY` remains optional —
  verify changes both with and without it, since the heuristic path is a supported mode, not an error.
- **SEO content is hand-maintained in two places**: the JSON-LD `WebApplication` + `FAQPage` blocks in
  `index.html` and the visible copy in `SeoFaqSection.tsx`. Both still hardcode scoring prose that has
  drifted from `SCORING` — the FAQ advertises "+5 to +10". Rendering these from `SCORING` is an open
  improvement.
