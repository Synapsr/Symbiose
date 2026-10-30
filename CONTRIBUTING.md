# Contributing

Thanks for helping! A few conventions keep the project coherent:

- **Numbers are deterministic.** The AI proposes strategies and estimates; anything shown as a target or total goes through `packages/shared` and is unit-tested.
- **The goal decides the UI.** New screens should put the person's focus nutrients first and keep calories optional (`hideCalories`).
- **Two gestures.** Before adding a step to a flow, look for a way to remove one.
- **Kind words.** No shaming, no red for "bad" food: amber means "over your own limit", and copy always suggests a next step.
- **Motion with purpose.** Use the primitives in `apps/mobile/src/components/ui` (`Pressy`, `Reveal`, `Ring`, `Bar`, `AnimatedNumber`, `SwapIcon`) so press feedback, haptics and easing stay consistent.

Before opening a PR: `pnpm typecheck && pnpm test && pnpm lint`. To work on the UI without an API key, run the server with `AI_MOCK=true`.
