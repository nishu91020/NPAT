# Build: migrate from Gemini to Microsoft Foundry

Implementation tickets for the approved spec at
[../azure-foundry-migration/spec.md](../azure-foundry-migration/spec.md).

The decisions behind these tickets live in
[../azure-foundry-migration/](../azure-foundry-migration/) — the wayfinder map and its resolved
decision tickets. Read the spec first; these tickets deliberately do not restate its reasoning.

## Order

```
01 config ──┬── 02 judge ──┬── 03 content filter ──┐
            │              ├── 05 judgedBy ────────┤
            │              └───────┐               │
            └── 04 bonus ──────────┴── 06 diff ────┴── 07 retire Gemini
```

- **01** is a prefactor: it lands green and changes nothing a player sees.
- **02** and **04** are independent once 01 is done, so they can run in parallel.
- **07 is last by design.** The quality diff in 06 needs both providers alive, so Gemini survives
  until it has been proven replaceable. This is the contract half of expand–contract.

## Prerequisite

An Azure resource with two deployments must exist before **02** can be verified live. That is
[../azure-foundry-migration/issues/04-provision-foundry-resource.md](../azure-foundry-migration/issues/04-provision-foundry-resource.md),
which the user is doing manually. Ticket 01 can be built and tested before it exists.

## Working these

One ticket per fresh context window. Each is self-contained; the previous one's context is
disposable. Every ticket lands green — lint, tests, and build pass at every step.

## Status

| Ticket | State |
|---|---|
| 01 config and client | done |
| 02 judge adapter | done, live verification pending a deployment |
| 03 content filter | done |
| 04 bonus source | done |
| 05 judgedBy badge | done |
| 06 golden-set diff | **blocked** — needs live Azure *and* live Gemini to diff against |
| 07 retire Gemini | blocked by 06 |

Everything buildable without cloud credentials is built: 126 tests, lint and build green. The
remaining two tickets are blocked on the provisioning step in
[../azure-foundry-migration/issues/04-provision-foundry-resource.md](../azure-foundry-migration/issues/04-provision-foundry-resource.md),
which the user is doing manually.

Note the provisioning step now has a hard dependency on the RBAC role assignment: authentication is
Entra ID with no API-key fallback, so without the *Cognitive Services OpenAI User* role every call
401s.