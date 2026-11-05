# Architecture

## Overview

```
 On your phone and wrist                   The API (packages/core)                       Outside
 ──────────────────────                   ──────────────────────                       ───────
 App (Expo: iOS, Android, web) ─┬─ in memory ─► on the phone: expo-sqlite ──┐
                                └─ JSON ──────► or your server: one container ─┤──► AI adapter ──► ChatGPT plan, Claude,
 Apple Watch app, widgets ───── through the app, or JSON to the server ──────┘                    OpenAI, Mistral, Gemini,
 Apple Health / Health Connect ─► app                                         ├──► SQLite (Drizzle) + photos   OpenRouter, Ollama…
                                                                              ├──► deterministic nutrition math
                                                                              └──► barcode lookup ──────────► Open Food Facts
```

- `packages/shared` holds the contract: zod schemas, types, nutrient metadata and every piece of nutrition math (targets, scaling, sanity checks, adaptive energy, dates). Everything imports it, so numbers are computed the same way everywhere.
- `packages/core` is the API: the Hono routes, the services, the AI adapters, the Drizzle schema and its migrations. It uses web APIs only (fetch, Web Crypto, streams; its `tsconfig` refuses `node:` imports, `Buffer` and `process`), so it runs in two hosts:
  - `apps/server`, the Node host: better-sqlite3 (WAL) and photos in `DATA_DIR`, accounts with signed tokens, sign-up and the admin view, backups before migrations, bundled into a single file with tsup;
  - `apps/mobile/src/local`, the app on its own: expo-sqlite in the app's documents, one person, the AI the person chose (see [On the phone, without a server](#on-the-phone-without-a-server)).
- `apps/mobile` is an Expo Router app. Its API client (`lib/api.ts`) is the same in both cases: only the transport changes (`fetch`, or `inProcessFetch`). Server state goes through React Query; small client state (the offline queue, toasts, settings) lives in zustand stores. Native targets (the watch app, its complications, the widgets and Live Activity) are SwiftUI, built with `@bacons/apple-targets`.
- `website/` is the public site: Vite, React and a prerender step, served by nginx. It has its own `package.json` and isn't part of the pnpm workspace.

## On the phone, without a server

Tapping **Get started** runs the API inside the app (`createLocalApi`, `packages/core/src/local.ts`):

- **Database.** `Documents/SQLite/symbiose.db` through expo-sqlite, whose Drizzle driver is synchronous like better-sqlite3: the services run unchanged. The migrations are the server's, bundled as strings (`packages/core/src/db/migrations.ts`, checked in CI) and applied with the same hashes and timestamps.
- **One person.** The first row of `users` (created on first open, with an address that can't exist and no password) is every request's user (`singleUser`). No tokens, no sign-up, no admin.
- **Transport.** `inProcessFetch` calls `app.request` in the app's engine. React Native's `Response` (whatwg-fetch) can't carry a stream, so `supportStreamingResponses` installs one that can: the coach, the morning check-in and the craving tip stream as they do from a server. An AI that can't be reached becomes a network error, so the offline queue keeps the capture.
- **Photos.** `Documents/photos/<id>.jpg`, shown straight from the file.
- **The AI.** Chosen on the phone and kept in the Keychain/Keystore (`src/local/ai-settings.ts`): the person's **ChatGPT plan** (Sign in with ChatGPT, plan usage: `ai/chatgpt.ts` on the Responses API, always streamed and not stored; PKCE with a one-shot loopback server on `127.0.0.1` in `modules/loopback-auth`, since OpenAI only redirects there), **OpenRouter** (OAuth PKCE, a key of their own account), a key from Anthropic, OpenAI, Google or Mistral, or an OpenAI-compatible server on their network. Before anything is sent, the screen names the provider and what it receives (App Store 5.1.2(i)).
- **Waiting for the AI.** With no AI yet, ChatGPT to reconnect or its limit reached, a capture waits in the offline queue (« En attente de ton IA ») and goes when the AI is back.
- **Backups.** One SQLite file (`packages/core/src/backup.ts`): the person's rows, their photos as blobs, and what made it. Shared from the phone (Drive, iCloud Drive, Files), restored by swapping the database, or sent to a server (`POST /api/me/restore`) and fetched back (`GET /api/me/backup`). iCloud backs up the app's documents; on Android, Auto Backup keeps the database but not the photos (`plugins/with-backup-rules.js`).
- **Watch and widgets.** The widgets show what the app last shared (no network); a Live Activity's outcome waits for the app. The watch sends its requests to the iPhone over WatchConnectivity: answered while the app runs, queued until it opens otherwise (`modules/watch-bridge`, `lib/watch.ios.ts`).

## The AI proposes, code computes

The model never sets a number the user sees without a deterministic pass.

**Goals.** The user's own words go to `POST /api/goals/draft`. The AI returns a *strategy* (calorie mode and %, protein g/kg, fat share, daily rules such as "added sugar ≤ 25 g", focus nutrients, habits, coaching tone). The server clamps it (`services/goals.ts`): deficit ≤ 25 %, surplus ≤ 20 %, protein 0.8–2.4 g/kg, realistic bounds per rule. `computeTargets` then derives every target from the profile:

- BMR with Mifflin–St Jeor, maintenance = BMR × activity multiplier;
- with "adjust for activity" and watch data: maintenance = BMR × 1.2 + 80 % of measured active energy (wearables overestimate);
- deficits never go below BMR or a sex-specific floor (1200/1500 kcal);
- defaults follow WHO/EFSA (free sugars < 10 % of energy, saturated fat < 10 %, sodium < 2 g, fibre ≥ 25 g), then the plan's rules, then the user's manual overrides.

Without an AI, a keyword-based planner produces a reasonable plan so the app stays usable.

**Adaptive energy.** Once there are enough complete days and weigh-ins, `packages/shared/src/expenditure.ts` measures what the person really burns: average logged intake minus the energy of the weight trend (a Theil–Sen line, so a water spike barely moves it), over the last 14 to 28 days. Partial days don't count, and nothing is estimated until the data is good enough. If the person opts in, the daily budget follows the measure by at most 100 kcal a week.

**Meals.** `POST /api/meals` with a photo and/or text runs one vision call with structured output (`ai/prompts.ts`, `ai/shared.ts`, then `ai/claude.ts` or `ai/openai.ts`). The prompt asks for edible grams and nutrients **per 100 g as served** from reference tables, with explicit rules for added vs total sugars and hidden fats. The server then:

1. sanitizes each item (`sanitizePer100g`): physical bounds, added sugar ⊂ sugar ⊂ carbs, saturated ⊂ fat, and an Atwater energy check that replaces a kcal value inconsistent with the macros by more than 35 %;
2. stores items per 100 g, so any portion change is an exact rescale;
3. computes goal-aware flags deterministically (share of each watched daily target used by the meal);
4. keeps the AI's verdict, one-sentence headline, up to two tips, and at most one clarification question when the answer would change the estimate materially.

Answering the question or typing a correction calls `/refine`, which re-runs the analysis with the previous items and the correction.

**Courses.** A meal may have several courses: the starter noted, the main photographed 20 minutes later, then dessert. A capture sent with `course: 'auto'` joins the meal it closely follows (same day, within 75 min of its last course, 45 after a snack, never across to another main meal: `courseTarget` in `packages/shared`), or `course: { mealId }` the meal chosen on the phone. The AI analyses the new course knowing the ones before it and judges the whole meal: one verdict, one headline. A correction sends every course (each photo labelled with its course) and returns the whole meal. Courses live in one JSON column of the meal row, items say theirs with `courseId`, and a meal of one course keeps its photo and words in its own columns, so older meals need no rewrite and every total (day, Trends, coach, review, health store) still sums one meal's items.

**Words about the past.** When a description or a correction refers to an earlier meal (« le reste du gratin d'hier soir », « comme mardi midi »: `refersToPast`), the analyst also gets the last week's meals, compact (title and items with grams, a few hundred tokens), and names the one it reused; the server copies that meal's values per 100 g as they were logged. Other captures send nothing more.

**Barcodes** go to Open Food Facts. When a product doesn't report added sugars, they are inferred from the ingredient list.

## The coach

The coach answers in light Markdown, streamed word by word (`POST /api/coach/messages/stream`). Its context is built on the server: the plan and targets, today's meals, recent days, cravings, activity, and the modules the person turned on (sleep, water, mood, blood pressure, journal). It can **propose**, never act alone: a new plan (`propose_plan_change`) or adding, fixing or deleting a meal (`propose_meal_action`). Each proposal is a card the person confirms.

It also writes on its own, from the same data:

- **the morning check-in** (`/api/proactive/morning`), from last night's sleep, recovery when the watch measures it, and yesterday; written once a day, when the app opens;
- **the craving heads-up**, a short line a little before the hour cravings usually come, from a week of nudges written at once (`/api/proactive/nudges`);
- **the weekly review**, cached in `ai_cache` by a hash of its inputs, so it is written again only when the week changed.

The phone schedules these as local notifications (`expo-notifications`, no push service).

## AI providers

Claude is the default and the reference on a server (`ai/claude.ts`): structured outputs, per-task effort, cached system prompts and server-side refusal fallbacks. `AI_PROVIDER` picks another provider (`ai/providers.ts`): they all go through one adapter on the OpenAI Chat Completions API (`ai/openai.ts`), with the same prompts, context, zod schemas and checks (`ai/shared.ts`), a strict JSON schema for structured answers, and the same error codes. A model that can't read photos answers photo meals with `ai_no_vision`; one that can't call tools gets a coach without proposals.

Every call reports its usage once (`AiUsageListener`): feature, provider, model, tokens, duration and an error code, never who asked or what was said. The server keeps these numbers 13 months for the admin view.

## Accounts and the admin view

The first account can always be created. After that, `SIGNUP` decides: `closed` (the default), `request` (anyone can ask, an admin approves) or `open`. A waiting account reaches nothing but itself (`blockPending` in `auth.ts`), so it can never start an AI call or store data. Passwords are hashed with scrypt; tokens are JWTs signed with a secret generated once in `DATA_DIR`.

Accounts whose email is listed in `ADMIN_EMAILS` see the admin view (`/api/admin`): the AI's calls, tokens and estimated cost, how much the app is used, the server's health, and the sign-up requests. Counts and totals only: never anyone's email (outside requests), name, meals or notes, and no per-person figure.

## On the phone

- **Offline queue** (`lib/outbox.ts`): every capture is saved on the phone before its first request. When the network fails, it waits with its original time and is sent again, oldest first, when the connection returns.
- **Dictation** (`lib/dictation.ts`, `expo-speech-recognition`): every text field can be dictated. On iOS, recognition stays on the device whenever it can.
- **Health** (`lib/health`): Apple Health or Health Connect, read and written by the app, then sent to the server. See [wearables.md](wearables.md).
- **Watch and widgets**: the app hands the session and the day's glance (`GET /api/glance`) to the widgets through the App Group, and to the watch through WatchConnectivity. Both then call the server themselves.

## Data model

| Table | Content |
| --- | --- |
| `users` | credentials (scrypt), sign-up state, profile and goal plan as JSON |
| `meals` | eaten-at (local time with offset), local date, items (JSON, per-100 g nutrients, each with its course), photo id, AI insight, courses (JSON, null for a meal of one course) |
| `photos` | ownership and mime of files in `DATA_DIR/photos` |
| `activity` | one row per day: steps, active/resting energy, source |
| `weights` | one body-weight reading per day |
| `workouts` | sessions from the health store or added by hand |
| `blood_pressure` | readings from the health store or added by hand |
| `sleep_nights` | one night per wake-up day: bedtime, wake time, time asleep |
| `water_logs` | drinks logged in the app or imported |
| `moods` | one check-in per day, with an optional note |
| `vitals` | nightly heart-rate variability and resting heart rate, one value per day and metric |
| `cravings` | what, intensity, outcome, AI tip |
| `journal_entries` | the health journal: transit, symptoms, medication, feelings, free notes |
| `coach_messages` | conversation, proposals, and the coach's own messages (morning check-in) |
| `ai_cache` | cached reviews keyed by a hash of their inputs |
| `ai_usage` | one row per AI call: feature, model, tokens, duration, error code |

Dates are always the device's local calendar day (`localDate`), and timestamps keep their UTC offset, so "when do I eat sugar" is computed in the user's local hours. Sleep, water, mood, blood pressure and vitals are stored whatever the switches say, and only shown or given to the AI when the person turned them on.

## API

On a server, all routes except `/health`, `/` and `/api/info` require `Authorization: Bearer <token>`. On the phone, the same routes answer for its one person, with no token; the server's own routes (sign-up, admin, backups, the QR page) aren't there, and `/api/local/ai-usage` counts this month's AI calls.

| Method | Path | |
| --- | --- | --- |
| GET | `/`, `/health`, `/api/info` | QR page, health check, version and sign-up state |
| POST | `/api/auth/register`, `/api/auth/login` | email + password → token |
| GET / PUT / DELETE | `/api/me`, `/api/me/profile`, `/api/me` | account; `GET /api/me/export` dumps everything |
| GET / POST | `/api/me/backup`, `/api/me/restore` | server only: the account as one backup file, and back (`?replace=1` for an account with data) |
| GET / POST / PUT | `/api/goals`, `/api/goals/draft`, `/api/goals` | current plan, preview a plan from text, save |
| GET / POST | `/api/meals?date=`, `/api/meals` | a day's meals; log one from a photo (base64 JPEG), text and/or items, or a course of a meal |
| GET / PATCH / DELETE | `/api/meals/:id` | edit portions, type, favourite… |
| POST | `/api/meals/:id/refine`, `/api/meals/:id/duplicate` | AI correction of the whole meal, "eat again" |
| POST / DELETE | `/api/meals/:id/courses/:courseId/separate`, `/api/meals/:id/courses/:courseId` | a course as a meal of its own, or deleted |
| POST | `/api/meals/:id/merge` | joins another meal of the day as courses (« Séparer », undone) |
| GET | `/api/days/:date` | targets, totals, progress, meals, activity, cravings, streak |
| GET | `/api/glance` | the key numbers for the watch, widgets and Live Activity, and meals to log again |
| GET | `/api/foods/library`, `/api/foods/barcode/:code` | recents and favourites, Open Food Facts lookup |
| PUT | `/api/activity` | daily health data from the phone |
| GET / PUT | `/api/weights` | weight trend, readings from the health store |
| GET / PUT / POST / DELETE | `/api/workouts`, `/api/workouts/:id` | sessions: list, import, add by hand, delete |
| GET / PUT / POST / DELETE | `/api/blood-pressure`, `/api/blood-pressure/:id` | trend, import, add a reading, delete |
| GET / PUT | `/api/sleep` | nights: trend, import |
| GET / POST / PUT / DELETE | `/api/hydration`, `/api/hydration/:id` | water: trend, add a glass, import, delete |
| GET / PUT / DELETE | `/api/mood`, `/api/mood/:date` | check-ins: trend, save the day's, delete |
| GET / PUT | `/api/vitals` | nightly vitals: recent values, import |
| GET / POST / PATCH / DELETE | `/api/journal`, `/api/journal/:id` | health journal notes |
| POST / PATCH | `/api/cravings`, `/api/cravings/:id` | log a craving and get a tip, record the outcome |
| POST | `/api/cravings/:id/tip/stream` | the tip, streamed |
| GET / POST | `/api/insights`, `/api/insights/review` | trends, top sources, by-hour distribution; AI review |
| GET / POST / DELETE | `/api/coach/messages`, `/api/coach/messages/stream` | coach conversation, streamed replies |
| POST | `/api/coach/messages/:id/meal-actions/:index/apply` (or `/dismiss`) | confirm or skip a proposed meal change |
| GET / PUT | `/api/proactive`, `/api/proactive/settings` | the coming notifications, their settings |
| POST | `/api/proactive/morning` (or `/stream`), `/api/proactive/nudges` | morning check-in, craving nudges |
| GET | `/api/admin/overview` | admins only: the server as a whole |
| GET / POST / DELETE | `/api/admin/requests`, `/api/admin/requests/:id/approve`, `/api/admin/requests/:id` | admins only: sign-up requests |
| GET | `/api/photos/:id` | meal photo (owner only) |

## Testing

- `packages/shared`: unit tests for energy, targets, adaptive energy, sanitization, the glance and dates.
- `packages/core`: the AI adapters against fake providers (Claude, OpenAI-compatible, the ChatGPT plan's Responses stream).
- `apps/server`: end-to-end API tests on an in-memory database with a fake AI and a fake Open Food Facts; the API run as the app runs it, with React Native's fetch classes (`local-mode.test.ts`); backups from a server to a phone and back (`backup.test.ts`); the bundled migrations against the server's (`core-parity.test.ts`).
- `apps/mobile`: unit tests for the pure logic (offline queue, dictation, Today, Markdown), typecheck and lint (React Compiler rules), plus manual runs on web and devices.
