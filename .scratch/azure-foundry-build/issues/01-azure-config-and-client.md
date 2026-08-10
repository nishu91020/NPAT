# 01 — Add Azure configuration and client construction

**What to build:** the app reads its Microsoft Foundry configuration and builds an `openai` client
from it, without yet changing how any round is judged. A developer with no Azure configuration set
sees exactly today's behaviour; a developer who has set it partially is told immediately, at
startup, rather than discovering it when a round silently scores heuristically.

This is a prefactor — make the change easy, then make the easy change. It lands green and is
invisible to players.

**Blocked by:** None — can start immediately.

**Status:** done

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §3, §4, §7

- [x] `npm install openai @azure/identity`; `@google/genai` stays for now (ticket 07 removes it)
- [x] Three variables read: `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_JUDGE_DEPLOYMENT`,
      `AZURE_OPENAI_BONUS_DEPLOYMENT`. No credential variable — Entra ID supplies it at call time
- [x] All four absent → no client, heuristic-only, identical to today's behaviour
- [x] Some but not all present → process exits at startup naming the missing variables
- [x] Client uses `baseURL` ending `/openai/v1/` and sets `maxRetries: 3`
- [x] Config resolution is a pure function of an env-shaped object, unit tested without touching
      `process.env` — all-absent, all-present, and each partial permutation
- [x] `.env.example` documents all four
- [x] `npm run lint` and `npm test` pass; existing 48 tests untouched

## Notes

Done. `openai` 7.4.0 installed. Config lives in `server/azure/` as a pure function of an
env-shaped object, so all permutations are unit tested without touching `process.env`.

15 new tests (63 total, up from 48). All three runtime paths verified live:
- **unconfigured** -> no Foundry line at startup, round scored `judgedBy=heuristic`, identical to before
- **partial** -> exits 1 naming every missing variable
- **complete** -> starts and logs the judge deployment

Two details worth carrying into ticket 02: the endpoint has its trailing slash stripped so joining
with `/openai/v1/` cannot double up, and the deployment names are carried on the client object
because the API's `model` argument is the *deployment* name, not the model name.