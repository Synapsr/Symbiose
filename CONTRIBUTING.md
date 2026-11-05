# Contributing

Thanks for helping! Symbiose aims to stay simple: before adding a screen, a
step or a setting, look for a better default.

## Setup

You need [Node.js](https://nodejs.org) 22 (`nvm use`) and [pnpm](https://pnpm.io) 10.

```sh
pnpm install
cp apps/server/.env.example apps/server/.env   # add an AI key, or set AI_MOCK=true
pnpm dev:server                                # API on http://localhost:3000
pnpm dev:mobile                                # Expo; press w for the browser
```

In the app, enter `http://localhost:3000` as the server (your computer's LAN
address from a phone) and create an account.

- **No API key?** `AI_MOCK=true` gives canned answers, enough for any UI work.
- **The browser** is the fastest loop for screens. Health, the camera, widgets
  and the Apple Watch need a development build: `pnpm --filter @symbiose/mobile ios`
  (or `android`), which runs `expo run`. Xcode or Android Studio required.
- **The website** is its own small project: `cd website && npm ci && npm run dev`.

## Checks

CI runs these on every pull request; run them before pushing:

```sh
pnpm typecheck && pnpm test && pnpm lint
cd website && npm run build      # if you touched the website
```

## Conventions

- **Commits** read `Area: sentence`, short: `App: the coach's replies show
  their bold, lists and paragraphs`, `Server: …`, `Website: …`, `Docs: …`.
  One idea per commit, and say why when it isn't obvious. Keep them to the
  change itself: no `Co-Authored-By` or "Generated with" lines (CI fails on
  the ones tools add).
- **Strings** go in both `apps/mobile/src/i18n/fr.ts` and `en.ts`. French is
  the main language: warm, short, and on first-name terms (*tu*).
- **Screenshots** in the pull request for any visible change: before and
  after, light and dark.
- **Numbers are deterministic.** The AI proposes strategies and estimates;
  anything shown as a target or total goes through `packages/shared` and is
  unit-tested.
- **The goal decides the UI.** Put the person's focus nutrients first and keep
  calories optional (`hideCalories`).
- **Kind words.** No shaming, no red for "bad" food: amber means "over your
  own limit", and copy always suggests a next step.
- **Motion with purpose.** Use the primitives in `apps/mobile/src/components/ui`
  (`Pressy`, `Reveal`, `Ring`, `Bar`, `AnimatedNumber`, `SwapIcon`) so press
  feedback, haptics and easing stay consistent.
- **The API lives in `packages/core`** (routes, services, AI adapters, schema)
  and runs in two places: the Node server (`apps/server`) and the app on its
  own (`apps/mobile/src/local`). Keep it free of Node APIs: no `node:` imports,
  `Buffer` or `process` (its `tsconfig` refuses them).
- **Database changes** are Drizzle migrations: edit `packages/core/src/db/schema.ts`,
  then `pnpm --filter @symbiose/core db:generate --name <what>`. It writes the
  migration and bundles it for the app; CI checks the bundle is up to date. The
  server applies migrations at start-up, after a backup; the app when it opens.

## Reporting

- [Report a bug](https://github.com/Synapsr/Symbiose/issues/new?template=bug_report.yml)
- [Suggest an improvement](https://github.com/Synapsr/Symbiose/issues/new?template=feature_request.yml)
- Found a security issue? See [SECURITY.md](SECURITY.md).
