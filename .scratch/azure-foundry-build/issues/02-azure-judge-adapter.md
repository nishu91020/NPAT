# 02 — Judge rounds with the Azure model

**What to build:** a completed round is judged by `gpt-4.1-mini` on Microsoft Foundry instead of
Gemini, when Azure is configured. The player sees the same result card; the difference is which
service ruled and that the response is schema-guaranteed rather than hoped for.

The existing `Judge` port does not change. This is a new adapter beside the Gemini one — both exist
until ticket 07 removes the old.

**Blocked by:** 01

**Status:** done

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §5, §6

- [x] `createAzureJudge(client, deployment)` satisfies `Judge` with no change to the port
- [x] Prompt split: fixed persona and rules in `system`, per-round data in `user`, so the prefix is
      cacheable
- [x] Strict JSON Schema with `additionalProperties: false` on the root and every nested object,
      every property in `required`
- [x] The schema still omits `points` — the referee derives them, the model cannot invent a score
- [x] Malformed, empty, or partial responses throw so `withFallback` reaches the heuristic
- [x] Tests mirror `geminiJudge.test.ts` against a fake client: well-formed parse, missing category,
      unparseable output, boolean coercion. No test touches the network
- [x] `server.ts` prefers the Azure judge when configured, else the heuristic
- [ ] Verified live against the real deployment: a real round scores end to end, and the observed
      Judge latency is recorded in a comment on this ticket — **BLOCKED: needs the Azure resource**

## Notes

Built and fully tested against a fake client; **23 new tests**, 91 total. Everything except live
verification is done.

**`$defs`/`$ref` sidestepped rather than risked.** Research flagged that strict-mode support for
references was unverified, and it cannot be checked without a live deployment. The schema is now
built by a function that defines the category shape once in code and **inlines it four times** in
the emitted JSON — one source of truth to maintain, plain JSON Schema on the wire. Tests assert the
output contains no `$ref` or `$defs`, and that `additionalProperties: false` appears on all six
objects with every property in `required`.

**Failure modes covered beyond the ticket:** the adapter also throws on a model refusal
(`message.refusal`), a filtered response (`finish_reason: 'content_filter'`) and a truncated one
(`finish_reason: 'length'`). All throw, so `withFallback` reaches the heuristic. Ticket 03 will
promote the content-filter case out of that catch-all into its own player-facing behaviour.

**`JudgedBy` gained `'azure'` here**, not in ticket 05, because this adapter emits the value and
would not compile without it. Ticket 05 still owns the UI badge and the stored-round rendering.

**Judge selection** in `server.ts` is Azure → Gemini → heuristic, each AI judge backed by the
heuristic. Verified live with a deliberately unreachable endpoint: the server logged the Foundry
deployment, the call failed, and the round still scored with `judgedBy=heuristic` — honest about who
actually ruled.
- [x] Confirm whether `$defs`/`$ref` survives strict mode; inline the four category copies if not

## Live verification — 2026-08-08

Endpoint `example-resource.services.ai.azure.com`, deployment `gpt-4.1-mini`, Entra ID via
`az login`.

**Latency 3.2s–4.9s** for the judge call. That is the "Verifying Answers..." spinner, and it is
slower than is comfortable — worth revisiting, but not a blocker.

**Judging quality is good.** It knew Shivaji is an Indian warrior king, Nilgai an Indian antelope,
Samosa a South Asian snack, and correctly denied Spain the India bonus. This is exactly the world
knowledge the heuristic cannot supply.

**Two bugs found by going live, both fixed:**

1. **Endpoint format.** The portal gives `https://<res>.services.ai.azure.com/openai/v1` — a
   different host to the one assumed, and it already includes the suffix the code appended. Every
   call would have 404d on `/openai/v1/openai/v1`. Resolution now normalises whichever form is
   pasted in, pinned by tests against the real URL.
2. **The model broke rule 1.** Under the India bonus, "Tiger" scored full marks for the letter S —
   a strongly on-theme answer beat the letter rule. The prompt is now emphatic that rule 1 overrides
   everything, but prompt wording alone is not a guarantee, so `enforceTargetLetter` overrules the
   model deterministically after the fact. The letter rule is mechanically decidable, so there was
   never a good reason to trust a model with it. Category validity and bonus matching still need
   world knowledge and are left to the judge. Re-verified live: the same round now scores 50, not 65.

**`ruleHint` came back at 38 characters against a stated max of 35**, confirming that strict mode
cannot enforce length. Harmless for a hint, but it means every length limit is advisory.