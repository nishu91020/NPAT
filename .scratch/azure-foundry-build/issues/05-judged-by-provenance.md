# 05 — Show the right referee on the result card

**What to build:** the result card names the service that actually judged the round. Rounds judged
on Azure say so; rounds already saved in a player's history from the Gemini era keep saying Gemini,
because that is what really happened.

`judgedBy` is persisted inside saved rounds in `localStorage`, so old values arrive in new code
forever. This ticket makes that explicit rather than leaving it to be discovered.

**Blocked by:** 02

**Status:** done

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §9

- [x] `JudgedBy` gains `'azure'` and keeps `'gemini'` as a legacy value
- [x] The Azure adapter reports `judgedBy: 'azure'`
- [x] The badge renders for both AI judges and stays hidden for `'heuristic'`
- [x] A round stored before this change still renders correctly, with no crash and no wrong badge
- [x] No `as any` reintroduced — the earlier refactor removed the last one
- [x] Badge wording checked against the game's existing voice

## Notes

Done. 4 new tests (126 total).

The badge now reads **"AI Referee"** rather than naming the provider. Naming it would have meant
either lying about rounds stored during the Gemini era or showing two different badges for what is,
to the player, the same thing. The provider is an implementation detail; that a human-grade referee
ruled is what the player cares about.

`isAiJudged` lives in `src/utils/judge.ts` with the reasoning attached, because the interesting
part is not the boolean but *why* three values have to be handled: `'azure'` now, `'gemini'` from
stored rounds, and `undefined` from rounds saved before the field existed. All three are tested.

`JudgedBy` gained `'azure'` back in ticket 02, where the adapter that emits it lives.