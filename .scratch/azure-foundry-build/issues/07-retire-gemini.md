# 07 — Retire Gemini

**What to build:** Gemini leaves the project. One AI provider, one set of credentials, one prompt to
maintain. The game behaves identically to the day before, except that nothing calls Google any more.

This is the contract step of an expand–contract migration: the new form has existed alongside the
old since ticket 02, and the diff in ticket 06 has already proven the replacement good.

**Blocked by:** 03, 04, 05, 06

**Status:** done

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §9

- [x] ~~Do not start unless ticket 06 met its gate~~ — 06 was skipped by the user; see that ticket
- [x] `server/referee/geminiJudge.ts`, `server/bonus/geminiSource.ts` and their tests deleted
- [x] `@google/genai` removed from `package.json`; lockfile updated
- [x] `GEMINI_API_KEY` removed from code and `.env.example`
- [x] `'gemini'` remains a valid `JudgedBy` value — stored rounds still carry it
- [x] The heuristic judge and `withFallback` are untouched; degraded mode still works with no Azure
      configuration at all
- [x] `.github/copilot-instructions.md` updated: the Gemini sections, the `RENDERABLE_ICONS`
      lockstep note, and the "no test runner" history are all stale after this
- [x] Full verification: `npm run lint`, `npm test`, `npm run build`, plus a live round scored and a
      daily challenge fetched twice to confirm the per-date cache
- [x] Client bundle grepped to confirm no SDK or prompt leaked into the browser

## Notes

Done. Gemini is gone: both adapters and their tests deleted, `@google/genai` uninstalled (29
packages removed), `GEMINI_API_KEY` removed from code, `.env.example` and the README.

Test count fell from 141 to **129** — the 12 that went were the Gemini adapter tests, which had
nothing left to test.

`RENDERABLE_ICONS` moved to `server/bonus/icons.ts` before deletion, since the Azure source
imported it from `geminiSource.ts`. It still has exactly one definition and still must stay in
lockstep with `ICON_MAP` in `LetterBanner.tsx`.

`judgedBy` keeps `'gemini'` as a legal value — it is persisted inside saved rounds in
`localStorage`, so players' stored history still carries it and must still render. `isAiJudged`
covers it and there is a test for exactly that.

Also refreshed the README, which still described the AI Studio scaffold and told the reader to set a
Gemini key, and `metadata.json`, which still declared `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`.

**Verified live, both modes:**
- Configured: `judgedBy=azure`, full round scored 80, daily bonus AI-generated
  ('Icelandic Initiative') and identical across repeated calls.
- Unconfigured (`.env` temporarily moved aside): logged 'running on the heuristic judge',
  `judgedBy=heuristic`, round still scored.

Client bundle re-checked: no SDK, no credential, no prompt.