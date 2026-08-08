# 07 — Retire Gemini

**What to build:** Gemini leaves the project. One AI provider, one set of credentials, one prompt to
maintain. The game behaves identically to the day before, except that nothing calls Google any more.

This is the contract step of an expand–contract migration: the new form has existed alongside the
old since ticket 02, and the diff in ticket 06 has already proven the replacement good.

**Blocked by:** 03, 04, 05, 06

**Status:** ready-for-agent

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §9

- [ ] Do not start unless ticket 06 met its gate
- [ ] `server/referee/geminiJudge.ts`, `server/bonus/geminiSource.ts` and their tests deleted
- [ ] `@google/genai` removed from `package.json`; lockfile updated
- [ ] `GEMINI_API_KEY` removed from code and `.env.example`
- [ ] `'gemini'` remains a valid `JudgedBy` value — stored rounds still carry it
- [ ] The heuristic judge and `withFallback` are untouched; degraded mode still works with no Azure
      configuration at all
- [ ] `.github/copilot-instructions.md` updated: the Gemini sections, the `RENDERABLE_ICONS`
      lockstep note, and the "no test runner" history are all stale after this
- [ ] Full verification: `npm run lint`, `npm test`, `npm run build`, plus a live round scored and a
      daily challenge fetched twice to confirm the per-date cache
- [ ] Client bundle grepped to confirm no SDK or prompt leaked into the browser
