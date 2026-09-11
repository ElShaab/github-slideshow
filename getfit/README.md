# GetFit

An AI-powered fitness application for iOS and Android. GetFit estimates your
body composition from a photo, builds a training program around it, guides you
through every workout, progresses your training from what you actually lift,
and reassesses your body every seven days.

The AI is a structured personal trainer, not a chatbot. Every decision it
makes — split, exercise selection, sets, reps, load, rest, warm-ups, cardio and
progression — is rule-driven, inspectable and testable.

---

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Database](#database)
- [Development commands](#development-commands)
- [Testing](#testing)
- [Mobile builds](#mobile-builds)
- [Apple subscription configuration](#apple-subscription-configuration)
- [Google subscription configuration](#google-subscription-configuration)
- [AI provider configuration](#ai-provider-configuration)
- [Photo storage configuration](#photo-storage-configuration)
- [Development mode](#development-mode)
- [Security model](#security-model)

---

## Overview

### The user journey

```
Open GetFit
  → Onboarding (8 screens: basics, level, location, equipment,
                schedule, goals, measurements, photo)
  → Body analysis                       ← no account needed yet
  → Body composition + 3D hologram
  → $5/month membership                 ← results always come before payment
  → Payment (Apple IAP / Google Play Billing)
  → Account created                     ← the guest is upgraded in place
  → Exercise preferences (4 choices per muscle, pick up to 3,
                          or one "Generate for me")
  → AI program generation
  → Home → guided workout → rest timer → completion + PRs
  → Progression applied automatically
  → 7 days later: new assessment, new metrics, new hologram
  → Progress, history and goal tracking
```

### What the AI actually does

| Service | Responsibility |
| --- | --- |
| `BodyAnalysisService` | Runs the configured vision provider, enforces the 7-day lock, persists the assessment, metrics and hologram |
| `ProgramGenerationService` | Split selection, exercise selection, ordering, sets/reps/rest, warm-ups, starting weights, cardio, session-duration fitting |
| `ExerciseSelectionService` | The four choices per muscle, the ≤3 limit, "Generate for me", and the pool the generator may draw from |
| `ProgressionService` | Next prescription from real performance — the home alternating ladder and gym auto-regulation |
| `WorkoutAdaptationService` | Reorganises the week around a missed session; lays out training days with recovery in mind |
| `GoalTrackingService` | Per-goal progress from measured data |
| `ProgressAnalysisService` | Body trends, strength curves, training stats |
| `SubscriptionService` | Server-side entitlement, store verification, the state machine and its audit trail |
| `PhotoStorageService` | Private, ownership-scoped photo storage |
| `UserService` | Onboarding, account completion, settings changes, deletion |

### Programming rules

- **Splits.** 1–3 days is full body. 4–5 days is upper/lower. 6–7 days is
  push/pull/legs. From four days up, every major muscle is trained at least
  twice a week.
- **Volume.** Roughly two exercises per muscle as a starting point, adjusted by
  level, days, session length and goals. Weekly effective sets are budgeted per
  muscle so compound overlap does not silently double a muscle's workload.
- **Secondary muscles.** Every compound pays into its secondary muscles at half
  a set each. `effective = direct + secondary`. Bench press is charged to the
  chest, the triceps and the front delts.
- **Reps.** Compounds 6–10, isolation 10–15 by default, shifted for a strength
  or fat-loss goal.
- **Warm-ups.** Two at most, only on the leading loaded compounds.
- **Cardio.** Treated as an exercise. Type chosen from available equipment,
  duration from body fat (27% → 15 min, 24% → 12, 21% → 8, 18% → 5), capped at
  15 minutes for everyone, and it falls automatically as body fat improves.
- **Session length.** The finished workout always fits the duration the user
  chose. Exercises are added in priority order only while they still fit.
- **No deloads** are ever scheduled automatically.

### Progression

Home training follows an alternating ladder:

```
Week 1   60 kg × 3 sets
Week 2   60 kg × 4 sets
Week 3   62.5 kg × 3 sets
Week 4   62.5 kg × 4 sets
```

Gym training auto-regulates weight, sets and reps from performance:

```
60 × 10, 60 × 10, 60 × 10   → 62.5 kg     (every set at the top of the range)
60 × 10, 60 ×  9, 60 ×  8   → hold 60 kg  (add reps before load)
60 ×  8, 60 ×  7, 60 ×  6   → 55 kg       (two sets under the range)
```

The user never enters RPE, mood, readiness or pain. Only weight, reps and sets.
If they change the prescribed weight mid-workout, both the prescription and the
actual are stored, and the actual is what drives the next session.

---

## Architecture

```
getfit/
├── packages/
│   ├── shared/          Domain types, exercise library, volume model
│   │   └── src/
│   │       ├── types.ts          Every shared domain type
│   │       ├── muscles.ts        Muscle groups, equipment, volume factors
│   │       ├── constants.ts      Product rules (≤3 per muscle, 7-day lock, …)
│   │       ├── volume.ts         Direct / secondary / effective set maths
│   │       └── exercises/        159 strength + 8 cardio exercises, full metadata
│   │
│   ├── server/          Node + Express + PostgreSQL API
│   │   ├── src/
│   │   │   ├── ai/               Body-analysis provider interface, mock, remote
│   │   │   ├── billing/          Apple, Google and mock store verification
│   │   │   ├── config/           Environment loading and production guards
│   │   │   ├── db/               Pool, migration runner, seed, reset
│   │   │   ├── middleware/       Auth, subscription gate, validation, errors
│   │   │   ├── migrations/       Raw SQL migrations
│   │   │   ├── repositories/     All SQL, scoped by user id
│   │   │   ├── routes/           HTTP surface
│   │   │   └── services/         The AI and domain services listed above
│   │   └── tests/                90 tests
│   │
│   └── mobile/          Expo + React Native client
│       ├── App.tsx
│       └── src/
│           ├── api/              Typed client with offline caching
│           ├── components/       20 reusable components + illustrations
│           ├── navigation/       Stage-driven root navigator, bottom tabs
│           ├── screens/          Onboarding, analysis, membership,
│           │                     preferences, main tabs, workout, history,
│           │                     settings
│           ├── state/            Session, onboarding draft, billing adapters
│           └── theme/            Palette, tokens, ThemeProvider
```

### Why the packages are split this way

The exercise library, the volume model and every domain type live in
`@getfit/shared`, which both the server and the app import. The database is
seeded from the same data the client renders, so the two can never drift.

### Data model

25 tables with foreign keys, indexes and timestamps. Every user-owned row
carries `user_id` with `ON DELETE CASCADE`, so account deletion is one
statement and leaves nothing behind.

```
users ─┬─ user_profiles              ─┬─ workout_programs ─┬─ workout_days
       ├─ user_goals                  │                     └─ workout_exercises
       ├─ user_equipment              │                         └─ prescribed_sets
       ├─ exercise_preferences        ├─ scheduled_workouts
       ├─ user_photos                 ├─ completed_workouts ─┬─ completed_exercises
       ├─ body_assessments ─┬─ body_metrics                  │    └─ completed_sets
       │                    └─ body_holograms                └─ personal_records
       ├─ subscriptions ── subscription_events
       ├─ progress_records
       └─ app_settings

muscle_groups ── exercises            (reference data, seeded from @getfit/shared)
```

`prescribed_sets` and `completed_sets` are deliberately separate tables. The
prescription is never overwritten by what was actually lifted.

---

## Setup

Requirements: **Node 20+**, **PostgreSQL 14+**, and for device builds, Xcode
(iOS) or Android Studio (Android).

```bash
git clone <repo>
cd getfit
npm install

cp .env.example .env
# edit .env — at minimum set DATABASE_URL and JWT_SECRET

createdb getfit
npm run db:migrate
npm run db:seed

npm run dev:server     # http://localhost:4000
npm run mobile         # Expo dev server
```

The API server also runs migrations and the seed at boot, so a fresh
environment is usable immediately. Both are idempotent.

---

## Environment variables

Every variable lives in `.env.example`. Copy it to `.env` and fill it in.
**Never commit a real `.env`.**

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables the production guards below |
| `PORT` | `4000` | API port |
| `DATABASE_URL` | local postgres | PostgreSQL connection string |
| `DATABASE_SSL` | `false` | Enable TLS for managed databases |
| `DATABASE_POOL_MAX` | `10` | Connection pool size |
| `JWT_SECRET` | dev placeholder | **Required in production.** `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | `30d` | Access-token lifetime |
| `MOCK_AI_MODE` | `true` | Serve body analysis from the deterministic mock |
| `AI_PROVIDER` | `mock` | `mock`, or a name for your production provider |
| `AI_BASE_URL` | — | Vision endpoint base URL |
| `AI_API_KEY` | — | Vision endpoint bearer token |
| `DEV_MODE` | `true` outside production | Exposes `/api/dev` test helpers |
| `MOCK_BILLING` | `true` outside production | Enables the mock store |
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `STORAGE_LOCAL_PATH` | `./storage/photos` | Local photo root |
| `STORAGE_S3_BUCKET` / `STORAGE_S3_REGION` | — | S3 target |
| `MAX_PHOTO_BYTES` | `12582912` | Upload cap (12 MB) |
| `APPLE_BUNDLE_ID` | `com.getfit.app` | iOS bundle identifier |
| `APPLE_SHARED_SECRET` | — | App-specific shared secret for receipt validation |
| `APPLE_VERIFY_URL` / `APPLE_SANDBOX_VERIFY_URL` | Apple defaults | Receipt endpoints |
| `GOOGLE_PACKAGE_NAME` | `com.getfit.app` | Android package |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | Service-account JSON on one line |
| `CORS_ORIGINS` | `*` | Comma-separated allowlist |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `EXPO_PUBLIC_API_URL` | — | API base URL baked into the app |

### Production guards

The server **refuses to boot** in production when `JWT_SECRET` is still the
development placeholder, or when `MOCK_BILLING` is enabled. `/api/dev` is not
mounted at all when `NODE_ENV=production`.

---

## Database

Migrations are plain SQL in `packages/server/src/migrations`, applied in
filename order and tracked in `schema_migrations`. Each runs in a transaction.

```bash
npm run db:migrate     # apply pending migrations
npm run db:seed        # migrate, then seed muscle groups and 159 strength and 8 cardio exercises
npm run db:reset       # drop, recreate, migrate and seed (refuses in production)
```

To add a migration, create `packages/server/src/migrations/00N_name.sql` and
run `npm run db:migrate`. Migrations are never edited after they have shipped.

The exercise library is seeded from `@getfit/shared` with `ON CONFLICT DO
UPDATE`, so re-running the seed picks up library changes without touching user
data.

---

## Development commands

```bash
npm run dev:server      # API with watch mode
npm run build:server    # Compile the API to dist/
npm run start:server    # Run the compiled API
npm run build:shared    # Compile the shared package
npm run typecheck       # Typecheck shared + server
npm test                # Run the server test suite
npm run mobile          # Expo dev server
npm run mobile:ios      # Build and run on iOS
npm run mobile:android  # Build and run on Android
npm run db:migrate | db:seed | db:reset
```

Inside `packages/mobile`, `npm run typecheck` checks the app.

---

## Testing

```bash
npm test
```

90 tests run on Node's built-in test runner. They cover:

- **Exercise selection** — four choices per muscle, the ≤3 limit, equipment
  filtering, "Generate for me", and that a manual selection is the *only* pool
  the generator may use
- **Program generation** — the split for every day count, session-duration
  limits at every length, twice-weekly major-muscle frequency, rep bands,
  exercise ordering, warm-up caps, starting weights, cardio scaling and caps,
  and secondary-muscle volume accounting
- **Progression** — the home alternating ladder, gym auto-regulation, backing
  off after failed sets, bodyweight progression, and that a weight changed
  mid-workout drives the next prescription
- **Personal records** — detection, previous values, and that warm-ups and
  light high-rep sets cannot fake a record
- **Adaptation** — missed workouts rescheduled rather than deleted, week layout
- **Body analysis** — dynamic (never hardcoded) values, determinism for the
  same photo, sex and BMI sensitivity, week-to-week coherence, confidence
  scoring, and hologram payloads that describe only the current body
- **End to end** — the complete journey against a real database and the real
  Express app: guest session, onboarding, analysis before payment, the
  subscription gate, a declined payment, a verified purchase, account creation,
  preference limits, program generation, a guided workout with a changed
  weight, the 7-day assessment lock and its unlock, history without photos,
  progress from real data, missed-workout reorganisation, settings-driven
  regeneration, photo access control, cross-user isolation, expiry, renewal and
  account deletion

The end-to-end suite skips itself automatically when no database is reachable,
so `npm test` is safe in any environment.

---

## Mobile builds

The app is an Expo project using the managed workflow with native modules.

```bash
cd packages/mobile

npm start                 # Expo dev server
npx expo run:ios          # Debug build on a simulator or device
npx expo run:android
npx expo prebuild         # Generate the native ios/ and android/ projects
```

### Production builds

```bash
npm install -g eas-cli
eas login
eas build --platform ios      --profile production
eas build --platform android  --profile production
```

Set `EXPO_PUBLIC_API_URL` to your deployed API before building. On a simulator
against a local server, Android reaches the host at `http://10.0.2.2:4000`,
which the client already handles.

### In-app purchases and Expo Go

Store billing needs native code, so purchases do not work in Expo Go. The
client resolves its billing module at runtime: install
`expo-in-app-purchases` and build a development or production client to test
real purchases. Without it, the mock store is used when the server allows it.

---

## Apple subscription configuration

1. In **App Store Connect → Your App → Subscriptions**, create a subscription
   group and an auto-renewable subscription with product ID
   `getfit_membership_monthly` at **$4.99/month** (the $5 tier).
2. Do **not** configure an introductory offer — GetFit has no free trial.
3. Under **App Information → App-Specific Shared Secret**, generate a secret
   and set it as `APPLE_SHARED_SECRET`.
4. Set `APPLE_BUNDLE_ID` to your bundle identifier (default `com.getfit.app`).
5. Add the In-App Purchase capability to the iOS target (`npx expo prebuild`
   handles this when the billing module is installed).
6. Create a sandbox tester in App Store Connect to test purchases.

The server posts the receipt to Apple's production endpoint, retries against
the sandbox on status `21007`, and grants entitlement only from Apple's
response. The client's claim about its own subscription is never trusted.

---

## Google subscription configuration

1. In the **Google Play Console → Monetise → Subscriptions**, create a
   subscription with product ID `getfit_membership_monthly` and a monthly base
   plan at the $5 price point.
2. Do **not** add a free trial offer.
3. In Google Cloud, enable the **Google Play Android Developer API** and create
   a service account with the *Financial data* and *Manage orders* permissions.
4. Link the service account under **Play Console → Users and permissions**.
5. Download the service-account JSON and set it as
   `GOOGLE_SERVICE_ACCOUNT_JSON` (on a single line).
6. Set `GOOGLE_PACKAGE_NAME` to your package name.

The server signs a JWT with the service account, exchanges it for an access
token, and reads the purchase from the Android Publisher API server-side.

---

## AI provider configuration

Body analysis sits behind one interface:

```ts
interface BodyAnalysisProvider {
  readonly name: string;
  analyze(input: BodyAnalysisInput): Promise<BodyAnalysisResult>;
}
```

**Mock provider** (`MOCK_AI_MODE=true`, the default). Derives a plausible
estimate from the profile using published anthropometric relationships, then
perturbs it with a hash of the actual photo bytes. Results differ for every
user and every photo, stay stable for the same photo, and remain coherent week
to week. It is not a vision model — it exists so the entire product can be
built and tested without AI credentials.

**Remote provider.** Set `MOCK_AI_MODE=false`, `AI_PROVIDER` to your provider's
name, and `AI_BASE_URL` / `AI_API_KEY`. The server posts the photo and profile
to `POST {AI_BASE_URL}/body-analysis` and expects:

```json
{
  "bodyFatPercent": 21.8,
  "muscleMassKg": 61.2,
  "waistBodyRatio": 0.47,
  "symmetryPercent": 87,
  "confidence": 0.82
}
```

Hologram geometry is derived locally from those metrics, so the rendering
contract is identical whichever provider is configured.

To add a provider, implement the interface in `packages/server/src/ai/` and
return it from `getBodyAnalysisProvider()`.

---

## Photo storage configuration

Photos are **private by default** and are never served from a public URL.

- Storage keys are random UUIDs namespaced under the owning user, so nothing is
  enumerable.
- Every read goes through `GET /api/photos/:id`, which authenticates the
  request and looks the photo up with `WHERE id = $1 AND user_id = $2` — there
  is no code path that resolves a photo without a user id.
- Responses are sent with `Cache-Control: private, no-store`.
- The Progress and History screens never render photos. Assessment history
  strips `sourcePhotoId` before it leaves the server.
- Account deletion removes the stored files as well as the rows.

`STORAGE_DRIVER=local` writes to `STORAGE_LOCAL_PATH` with mode `0600`, with
path traversal blocked at the driver. It suits development and self-hosting on
a persistent volume.

`STORAGE_DRIVER=s3` stores objects with `ServerSideEncryption: AES256` in
`STORAGE_S3_BUCKET`, using the same user-namespaced keys. The bucket must stay
private: no ACL is set and no presigned URL is ever issued, so every read still
goes through the ownership-checked `GET /api/photos/:id`. Credentials are taken
from the standard AWS chain (instance role, environment, or profile).

Production refuses to start on `local`, since container disks do not survive a
deploy and the photos would be lost.

---

## Development mode

With `DEV_MODE=true` the server mounts `/api/dev` (never in production):

| Endpoint | Purpose |
| --- | --- |
| `GET /api/dev/config` | Reports which mocks are active and lists billing scenarios |
| `POST /api/dev/subscription/expire` | Forces the membership into `expired` to test the renewal screen |
| `GET /api/dev/subscription/events` | The full subscription audit trail |
| `POST /api/dev/assessment/backdate?days=7` | Backdates assessments to test the 7-day lock |
| `POST /api/dev/schedule/backdate?days=3` | Backdates sessions to test missed-workout reorganisation |

### Mock billing scenarios

With `MOCK_BILLING=true`, the receipt string selects the outcome:

| Receipt | Result |
| --- | --- |
| `mock-success` | A fresh 30-day period |
| `mock-expired` | A period that ended yesterday |
| `mock-cancelled` | Active, set to cancel at period end |
| `mock-failed` | The store declines the purchase |
| `mock-revoked` | Refunded or revoked |
| `mock-expiring-<n>` | A period ending in *n* minutes |

Everything in the spec's development-mode checklist — onboarding, photo upload,
mock analysis, payment success and failure, expiry, exercise selection,
"Generate for me", program generation, workout completion, weight changes,
missed workouts, the assessment lock, history, goals, and both themes — can be
exercised with these and the test suite.

---

## Security model

**Authentication.** JWT bearer tokens. Every protected route reads
`req.userId` from the verified token; a user id is never accepted from a body,
param or query.

**Authorisation.** Every repository query is scoped by `user_id`. A user can
only ever reach their own rows — verified by tests that attempt cross-user
reads of workouts, program days and photos.

**Subscription entitlement.** Recomputed on the server for every gated request
from a stored, store-verified period. An `active` subscription whose period has
ended transitions to `expired` on the next evaluation, so the very next request
is correctly blocked. Supported states: `active`, `expired`, `cancelled`,
`pending`, `failed`, `restored`. Every transition is written to an append-only
`subscription_events` table.

**Input validation.** Every write is validated with Zod before it reaches a
service. The ≤3-exercises-per-muscle rule is additionally enforced by a `CHECK`
constraint in the schema.

**Secrets.** No key, credential or receipt is ever logged. `.env` is
git-ignored and `.env.example` carries placeholders only.

**Error handling.** Unknown failures return `{"error":{"code":"internal_error",
"message":"Something went wrong."}}`. Stack traces never reach a client. The
app renders one error surface with a TRY AGAIN action, and a render-error
boundary catches anything that escapes.

**Rate limiting.** A general budget on the API, and a tighter one on
credential and purchase endpoints.

**Transport.** `helmet` sets security headers; CORS is allowlisted via
`CORS_ORIGINS` in production.

---

## Deliberate non-features

Per the product specification, GetFit has no social feed, no public profiles,
no sharing of photos, no chatbot, no injury diagnosis, no push notifications
(the assessment countdown is a small in-app reminder only), and no automatic
deload weeks.
