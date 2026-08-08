# 02 — Judge rounds with the Azure model

**What to build:** a completed round is judged by `gpt-4.1-mini` on Microsoft Foundry instead of
Gemini, when Azure is configured. The player sees the same result card; the difference is which
service ruled and that the response is schema-guaranteed rather than hoped for.

The existing `Judge` port does not change. This is a new adapter beside the Gemini one — both exist
until ticket 07 removes the old.

**Blocked by:** 01

**Status:** ready-for-agent

Spec: [../../azure-foundry-migration/spec.md](../../azure-foundry-migration/spec.md) §5, §6

- [ ] `createAzureJudge(client, deployment)` satisfies `Judge` with no change to the port
- [ ] Prompt split: fixed persona and rules in `system`, per-round data in `user`, so the prefix is
      cacheable
- [ ] Strict JSON Schema with `additionalProperties: false` on the root and every nested object,
      every property in `required`
- [ ] The schema still omits `points` — the referee derives them, the model cannot invent a score
- [ ] Malformed, empty, or partial responses throw so `withFallback` reaches the heuristic
- [ ] Tests mirror `geminiJudge.test.ts` against a fake client: well-formed parse, missing category,
      unparseable output, boolean coercion. No test touches the network
- [ ] `server.ts` prefers the Azure judge when configured, else the heuristic
- [ ] Verified live against the real deployment: a real round scores end to end, and the observed
      Judge latency is recorded in a comment on this ticket
- [ ] Confirm whether `$defs`/`$ref` survives strict mode; inline the four category copies if not
