# 05 — Show the right referee on the result card

**What to build:** the result card names the service that actually judged the round. Rounds judged
on Azure say so; rounds already saved in a player's history from the Gemini era keep saying Gemini,
because that is what really happened.

`judgedBy` is persisted inside saved rounds in `localStorage`, so old values arrive in new code
forever. This ticket makes that explicit rather than leaving it to be discovered.

**Blocked by:** 02

**Status:** ready-for-agent

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §9

- [ ] `JudgedBy` gains `'azure'` and keeps `'gemini'` as a legacy value
- [ ] The Azure adapter reports `judgedBy: 'azure'`
- [ ] The badge renders for both AI judges and stays hidden for `'heuristic'`
- [ ] A round stored before this change still renders correctly, with no crash and no wrong badge
- [ ] No `as any` reintroduced — the earlier refactor removed the last one
- [ ] Badge wording checked against the game's existing voice
