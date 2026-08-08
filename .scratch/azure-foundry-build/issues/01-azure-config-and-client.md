# 01 — Add Azure configuration and client construction

**What to build:** the app reads its Microsoft Foundry configuration and builds an `openai` client
from it, without yet changing how any round is judged. A developer with no Azure configuration set
sees exactly today's behaviour; a developer who has set it partially is told immediately, at
startup, rather than discovering it when a round silently scores heuristically.

This is a prefactor — make the change easy, then make the easy change. It lands green and is
invisible to players.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §3, §4, §7

- [ ] `npm install openai`; `@google/genai` stays for now (ticket 07 removes it)
- [ ] Four variables read: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`,
      `AZURE_OPENAI_JUDGE_DEPLOYMENT`, `AZURE_OPENAI_BONUS_DEPLOYMENT`
- [ ] All four absent → no client, heuristic-only, identical to today's behaviour
- [ ] Some but not all present → process exits at startup naming the missing variables
- [ ] Client uses `baseURL` ending `/openai/v1/` and sets `maxRetries: 3`
- [ ] Config resolution is a pure function of an env-shaped object, unit tested without touching
      `process.env` — all-absent, all-present, and each partial permutation
- [ ] `.env.example` documents all four
- [ ] `npm run lint` and `npm test` pass; existing 48 tests untouched
