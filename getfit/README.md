# GetFit

A fitness application for iOS and Android. GetFit calculates your body
composition from your own tape measurements, builds a training program around
it, guides you through every workout, progresses your training from what you
actually lift, and reassesses your body every seven days.

It is a structured personal trainer, not a chatbot. Every decision it makes —
split, exercise selection, sets, reps, load, rest, warm-ups, cardio and
progression — is rule-driven, inspectable and testable, and so is the body
analysis: published anthropometric formulas evaluated on numbers you measured,
with no external service in the loop.

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
- [Body analysis](#body-analysis)
- [Look and feel](#look-and-feel)
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
  → membership: $5/month or $20/year    ← results always come before payment
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
│           ├── components/       34 exported components + illustrations
│           ├── navigation/       Stage-driven root navigator, bottom tabs
│           ├── screens/          Onboarding, analysis, membership,
│           │                     preferences, main tabs, workout, history,
│           │                     settings
│           ├── state/            Session, onboarding draft, billing adapters
│           └── theme/            Palette, tokens, contrast maths, provider
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
| `AI_PROVIDER` | — | Empty uses the built-in measurement analyser; set it to opt into a vision endpoint |
| `AI_BASE_URL` | — | Vision endpoint base URL (required with `AI_PROVIDER`) |
| `AI_API_KEY` | — | Vision endpoint bearer token (required with `AI_PROVIDER`) |
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
npm run lint            # ESLint across all three packages
npm run typecheck       # Typecheck shared + server + mobile
npm test                # Run the server test suite
npm run verify          # lint, then typecheck, then tests
npm run mobile          # Expo dev server
npm run mobile:ios      # Build and run on iOS
npm run mobile:android  # Build and run on Android
npm run db:migrate | db:seed | db:reset
```

`npm run verify` is the gate to run before pushing. Every command that needs
the shared package builds it first, so a fresh clone works without a setup step.

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

The app is an Expo project (SDK 52) using the managed workflow with native
modules. It needs no server and no API URL — everything runs on the device.

```bash
cd packages/mobile

npm start                 # Metro, for an already-installed dev build
npx expo run:ios          # Build and run (simulator, or --device for a phone)
npx expo run:android
npx expo prebuild         # Generate the native ios/ and android/ projects
```

### Seeing it on a real phone

**Expo Go will not open this project.** Expo Go ships only the newest SDK, and
`react-native-iap` is native code it does not carry. You need a development
build — a small custom client with this project's native modules in it, which
then loads your JavaScript over the network like Expo Go does.

With the platform toolchain installed locally (Xcode, or Android Studio):

```bash
cd packages/mobile
npx expo run:ios --device      # pick the plugged-in iPhone; needs a Mac
npx expo run:android           # phone in USB-debugging mode
```

Without local native tooling, build it in the cloud and install the result:

```bash
npm install -g eas-cli && eas login
eas build --platform android --profile development   # APK, no account needed
eas build --platform ios     --profile development   # needs your Apple team
```

Then `npx expo start --dev-client` and scan the QR code. Edits reload live.

Android's development build is the cheapest route to real hardware: the APK
installs directly, with no developer account and no Mac. iOS needs a Mac for
`run:ios`, or a paid Apple Developer account for EAS to sign an internal
build and register the device.

### What only a device can tell you

The simulator gets the layout right and the materials wrong. Worth looking at
on hardware, in daylight:

- **Blur.** `expo-blur` is a true backdrop blur on iOS. On Android it is
  weaker, and on older devices it can degrade to a flat tint — the glass
  surfaces are built to still read as panels if that happens, but check.
- **Glow.** The cyan glow on the primary button, a focused input and a selected
  segment is a coloured `shadow*`, which iOS honours. Android draws shadows
  from `elevation` alone, in grey — so expect depth there, not colour.
- **Contrast.** The palette is tuned for 4.5:1 body text on glass over the
  brightest stop of the field, which is a number on a screen until you read
  it outdoors.
- **Dynamic Type.** Sizes scale with the OS font setting, capped so layouts
  survive the largest accessibility sizes.

### Production builds

```bash
eas build --platform ios      --profile production
eas build --platform android  --profile production
```

`npm run preflight --workspace @getfit/mobile` checks the release
prerequisites first and names what is missing.

### In-app purchases and Expo Go

Store billing needs native code. The app resolves `react-native-iap` at
runtime, so the bundle still runs where it is absent — it falls back to the
mock store instead of crashing. Real purchases need a development or
production build; see RELEASE.md.

---

## Apple subscription configuration

1. In **App Store Connect → Your App → Subscriptions**, create one subscription
   group containing both auto-renewable subscriptions:
   - `getfit_membership_monthly` at **$5.00/month**
   - `getfit_membership_yearly` at **$20.00/year**

   Put them in the same group so members can move between them, and rank the
   yearly plan higher so an upgrade takes effect immediately.
2. Do **not** configure an introductory offer — GetFit has no free trial. The
   yearly plan's "was $40" is presented as a limited-time discount on our own
   price, not as a store introductory offer.
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

1. In the **Google Play Console → Monetise → Subscriptions**, create two
   subscriptions:
   - `getfit_membership_monthly` with a monthly base plan at the $5 price point
   - `getfit_membership_yearly` with a yearly base plan at the $20 price point
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

## Body analysis

**No AI service is required, and none is configured by default.** Body
composition is computed from the user's own tape measurements using published
anthropometric formulas, on the server, with no network call:

| Figure | How it is produced |
| --- | --- |
| Body fat | US Navy circumference method — waist, neck, height (plus hips for women). Validates to roughly ±3-4% against DEXA. |
| Body fat, fallback | Deurenberg BMI formula, when there is no tape reading. Reported as `method: 'bmi'` with markedly lower confidence. |
| Muscle mass | Skeletal muscle as a share of fat-free mass, which follows exactly from body fat and weight. |
| Waist-to-height | The measured waist over the measured height. |
| Symmetry | The difference between the measured left and right limbs. With no limb pair measured it falls back to the figure for a typical adult that age and is labelled **Estimated**, the same way body fat falls back to BMI — never a default 100%, and never presented as a reading off that body. |

The same inputs always produce the same reading, and a user can check the
arithmetic. The photo is optional: it is stored privately as the user's own
before/after reference and is never analysed.

> This replaced a provider that took a Deurenberg BMI estimate and added
> `(hash(photo) - 0.5) * 7` to it — up to 3.5 percentage points of movement
> driven by nothing but file bytes, with a fully random symmetry score. A tape
> measure beats that comfortably, and costs nothing to run.

The formulas live in `packages/shared/src/bodyComposition.ts` as pure
functions, so the client and the server agree and both are directly testable.

### Optional vision provider

Body analysis sits behind one interface:

```ts
interface BodyAnalysisProvider {
  readonly name: string;
  analyze(input: BodyAnalysisInput): Promise<BodyAnalysisResult>;
}
```

Setting `AI_PROVIDER` (plus `AI_BASE_URL` and `AI_API_KEY` — production refuses
to boot with only some of the three) swaps in a remote vision endpoint. The
server posts the photo, profile and measurements to
`POST {AI_BASE_URL}/body-analysis` and expects:

```json
{
  "bodyFatPercent": 21.8,
  "muscleMassKg": 61.2,
  "waistBodyRatio": 0.47,
  "symmetryPercent": 87,
  "confidence": 0.82
}
```

Only `bodyFatPercent` is required; anything omitted is filled in from the
measurements. A figure read off a photo is reported as `method: 'vision'`, so
the app never presents it as a tape measurement. Hologram geometry is always
derived locally, so the rendering contract is identical whichever provider is
configured.

To add a provider, implement the interface in `packages/server/src/ai/` and
return it from `getBodyAnalysisProvider()`.

### The hologram

The figure on the results screen is built from the same numbers, and it is
drawn at a **5-point body-fat band** rather than at the exact reading. A tape
measure moves a point or two between weeks for reasons that have nothing to do
with the body — where it sat, time of day, how hard it was pulled — and a
figure that redraws itself on that noise invites someone to read a change into
it. The precise percentage is still what they read; only the picture is
quantised.

The figure is an anatomical one: a cranium and jaw with a face on it, arms
carried clear of the body with open hands, feet with toes, and a muscle map of
about twenty bellies — deltoids, pecs with their fan, serratus, an eight-block
rectus abdominis, obliques, biceps and triceps, forearm groups, quadriceps with
the sartorius crossing them, and gastrocnemius. Each belly carries fibre lines
running the way that muscle actually pulls, which is the part that makes it
read as a body rather than as decoration. Over the top is a point cloud
scattered from the stored seed and clipped to the skin, which is what gives the
reference renders their scanned-surface look.

**Fat is translucent, and the muscle is always drawn.** The figure is built as
two bodies: the muscle underneath, and the outer body a tape measure would go
around. The gap between the two outlines is the layer. It is painted as a
strong green ring where there is fat and nothing behind it, plus a light wash
over the whole figure so the layer reads as something seen through rather than
a gasket fitted around the outside.

That is why the body stays blue at every band and only the layer is green — and
why muscle someone has built never disappears. A figure that erased it at 40%
would be telling them it had.

| | Lean band | Heavy band |
| --- | --- | --- |
| Subcutaneous layer | a green hairline | a thick green ring |
| Widest point of the torso | the shoulders | the belly |
| Muscle fibre | crisp | soft, never absent |
| Soft folds across the abdomen | none | up to three |

Fibre and bellies fade by opacity, floored at a quarter of full definition,
rather than shrinking — the muscle is still there, you just cannot see its
shape through what is over it.

The abdominals are the one group not driven by a measurement. Nothing in a tape
reading describes how developed someone's abs are: the waist measures the fat
sitting on top of them. So they read from definition instead, or they would
glow brighter as their owner gained weight.

The figure is vector art, not a render. It will not reach a ray-traced
anatomical model — that would need licensed artwork or a real 3D mesh, and
neither belongs in a procedural figure that has to reshape itself to every
user's measurements.

Women's bands sit about 8 points higher at every equivalent level, which is
essential fat rather than a difference in condition, so a woman at 28% draws
with about the definition of a man at 20%.

`packages/shared/tests/hologram.test.ts` holds the band boundaries and
`packages/mobile/tests/hologramGeometry.test.ts` holds the silhouette rules —
including that every path is free of `NaN`, which SVG would otherwise swallow
by silently dropping a limb.

---

## Look and feel

The app is one continuous pane of electric blue glass: a saturated azure field
painted by `Screen`, two cyan blooms lighting it from the top and the bottom
corner, and frosted surfaces with a lit top edge floating on it. Cyan is the
only accent.

Every colour lives in `packages/mobile/src/theme/palette.ts`. No screen and no
component hardcodes a hex value, so the whole product moves together when a
token changes — including the app icon and the launch screen, whose artwork is
regenerated from the same blues by `scripts/generate-icons.py`.

### Two themes, one scheme

| Theme | Field | Type |
| --- | --- | --- |
| Deep (default) | `#0A4693` → `#062A66` | Near-white on frosted blue |
| Daylight | `#BBDCF6` → `#F2F8FE` | Deep azure on frosted white |

Daylight is the same blue seen in the sun, not a different identity. The
preference lives in Settings and resolves to the OS setting on `system`.

### Why the blues are tuned rather than sampled

Every surface is translucent, so the colour behind a label is the glass
composited over whatever stop of the field is behind it — a number that appears
nowhere in the tokens. A comp can put white text on a pale frosted panel and
look wonderful at desk brightness while landing near 3:1 on a phone outdoors.

So the field's brightest stop is held at a luminance where white body text on a
frosted card still clears 4.5:1, and the vivid end of the blue lives in the
blooms and the rims, where nothing has to be read. `tests/palette.test.ts`
composites the real stack of layers and asserts WCAG 2.1 AA ratios — 4.5:1 for
body text, 3:1 for large text and control boundaries — against the worst stop
of the field, in both themes. Painting the field with the comp's literal blue
fails four of those tests, which is the point of having them.

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
