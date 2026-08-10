# Choose the models and how many deployments

Type: grilling
Status: resolved
Blocked by: 01, 02

## Question

Which model backs each call site, and do they get one deployment or two?

Research recommends `gpt-4.1-mini` for the Judge and `gpt-4.1-nano` for the bonus generator, but
that is two deployments to provision, name, and configure. A single `gpt-4.1-mini` deployment
serving both is simpler and costs almost nothing extra given the bonus generator runs about once a
day.

Decide:
- One deployment or two, and the deployment name(s) — remember the deployment name is what the code
  passes as `model`, so it becomes configuration.
- Whether to pin a model version explicitly or track the latest.
- The named fallback if the chosen model is unavailable in the chosen region or blocked by quota.
- Whether the "one model per call site" split is worth the configuration surface it adds, given the
  two calls have genuinely different needs (knowledge-heavy at temperature 0.2 vs creative at 0.8).

## Answer

Approved as specified. `gpt-4.1-mini` for the Judge, `gpt-4.1-nano` for the bonus generator, two separate deployments, Global Standard. `gpt-5-mini` named as the fallback if quota or region blocks the primary. See spec section 2.
