# Decide the configuration shape and how Gemini is retired

Type: grilling
Status: open
Blocked by: 05

## Question

What configuration does the app read, and how does Gemini actually leave?

The working assumption from charting is full replacement — the Gemini adapters are deleted and
`@google/genai` is dropped. That assumption is worth testing here before anyone acts on it, since
the `Judge` port would happily hold both.

Decide:
- The environment variables the app reads, and what each does. Today it is a single
  `GEMINI_API_KEY`; the replacement needs at minimum an endpoint and a deployment name, which is
  more surface than one key.
- What the app does when Azure is unconfigured. Today a missing key silently means heuristic-only —
  is that still right when the config has several parts and a partial config is possible?
- Whether the deployment name belongs in configuration or in code. It is deployment-specific, so
  configuration, but that makes local and deployed environments diverge.
- Whether Gemini is deleted outright or kept behind a flag for one release as an escape hatch, and
  what evidence would justify keeping it.
- What `judgedBy` becomes. It is currently `'gemini' | 'heuristic'`, it is persisted inside saved
  game results in `localStorage`, and the UI keys the "Gemini AI Referee" badge off it. Old stored
  rounds will carry `'gemini'` forever — decide whether that matters and what the badge should say.
