# Provision a Foundry resource and deploy the models

Type: task
Status: open
Blocked by: 03

## Question

Nothing to decide — this unblocks the decisions that need a live endpoint. Neither `az` nor `azd` is
installed on this machine, and the Azure account state is unknown, so this ticket assumes the worst
case and shrinks if a subscription already exists.

Consult the `microsoft-foundry` skill — it covers resource creation, deployment, RBAC, quota, and
region selection directly.

Work to do:
- Confirm or create an Azure subscription.
- Install tooling (`az`, and `azd` if the skill's workflows want it).
- Create a Foundry resource in a suitable region; note the endpoint URL.
- Create the deployment(s) chosen in
  [Choose the models and how many deployments](03-choose-models-and-deployments.md), using Global
  Standard.
- Assign the calling identity the *Cognitive Services OpenAI User* (or *Foundry User*) role.
- Set a budget alert, so an unexpected spend is visible early.
- Verify with a single live structured-output call.

## Answer

Record here when done: the endpoint URL, the exact deployment name(s), the region, the quota tier
granted, where the key or credential lives, and anything that differed from the plan. Later tickets
depend on these facts.
