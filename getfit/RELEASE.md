# Shipping GetFit

Everything between a working checkout and an app in review. Steps marked
**[you]** need credentials, a hosted URL or a device, and cannot be done from
CI or by anyone but the account holder.

## Before you build

Run this first. It checks what App Review checks, and names exactly what is
missing:

```bash
cd packages/mobile
npm run preflight -- --profile production
```

A fresh checkout fails it with six items, and every one of them is something
only you can supply — a deployed API host, two hosted URLs, and three App Store
Connect identifiers:

| What | Where it goes | Section |
| --- | --- | --- |
| Your deployed API URL | `eas.json` → `build.production.env.EXPO_PUBLIC_API_URL` | 1 |
| Your hosted privacy policy | `app.json` → `extra.legal.privacyPolicyUrl` | 4 |
| Your support page | `app.json` → `extra.legal.supportUrl` | 4 |
| Apple ID, `ascAppId`, team ID | `eas.json` → `submit.production.ios` | 2 and 6 |

Your own terms are optional: leave `extra.legal.termsOfUseUrl` unset and the app
links to Apple's standard EULA, which is always live. `TERMS.md` is there if you
would rather host your own.

**None of this is optional, and none of it fails loudly on its own.** A build
with an unset API URL launches and reaches nothing, which reads to a reviewer as
a broken app rather than an unset variable — so a release build that fails these
checks refuses to start and says which field is missing, instead of looking
broken.

---

## 1. Deploy the API

Nothing in the app works until this exists — a release build points at the URL
configured in `eas.json`, and a reviewer opening an app that cannot reach its
server is an immediate rejection under Guideline 2.1.

```bash
cd getfit

fly launch --no-deploy              # [you] names the app, picks a region
fly postgres create --name getfit-db
fly postgres attach getfit-db       # sets DATABASE_URL
```

There is **no AI provider to configure**. Body composition is calculated on the
server from the user's tape measurements using published anthropometric
formulas, so there is no vision endpoint, no API key and no per-analysis cost.

Set the remaining secrets. The server **refuses to boot** if any of these is
missing or unsafe, which is deliberate — a misconfigured production deploy
fails loudly instead of quietly handing out free memberships:

```bash
fly secrets set \
  JWT_SECRET="$(openssl rand -base64 48)" \
  MOCK_BILLING=false \
  DEV_MODE=false \
  CORS_ORIGINS=https://[your-domain] \
  STORAGE_S3_BUCKET=[bucket] \
  STORAGE_S3_REGION=[region] \
  AWS_ACCESS_KEY_ID=[key] \
  AWS_SECRET_ACCESS_KEY=[secret] \
  APPLE_SHARED_SECRET=[from App Store Connect] \
  GOOGLE_SERVICE_ACCOUNT_JSON="$(cat play-service-account.json | tr -d '\n')"
```

The S3 bucket must be **private** — block all public access. Photos are served
only through authenticated, ownership-checked requests, and a public bucket
would defeat that entirely.

```bash
fly deploy
curl https://[your-app].fly.dev/health     # expect {"status":"ok"}
```

Migrations and the exercise seed run on every boot. Both are idempotent.

Then point the app at it, in `packages/mobile/eas.json`:

```json
"production": { "env": { "EXPO_PUBLIC_API_URL": "https://[your-app].fly.dev" } }
```

---

## 2. Turn on payments with Apple

**[you] Do this before anything else — it has a waiting period, and nothing
about in-app purchase works until it is finished.**

1. **Apple Developer Program** — $99/year. Enrolment is reviewed, so budget a
   day or two.
2. **App Store Connect → Business → Agreements.** Sign the **Paid Applications
   Agreement**, then complete the **banking** and **tax** forms attached to it.

> **This is the step that wastes people's weeks.** Until the Paid Applications
> agreement shows **Active**, `getSubscriptions()` returns an **empty array** and
> every purchase fails — with no error that points at the cause. The app looks
> broken, the code is fine. If products do not appear on a device, check this
> before you debug anything else.

3. **Create the app record** with bundle ID `com.getfit.app`, and copy its
   Apple ID into `eas.json` as `ascAppId`.
4. **Sandbox tester:** Users and Access → Sandbox → Testers. Use an email you
   control that has **never** been an Apple ID. This account is for testing
   only; never sign into the real App Store with it.

Google Play is the same shape: a $25 one-off registration, then Payments
profile under Setup → Payments, then the app record.

---

## 3. Create the store products

Product IDs must match `SUBSCRIPTION_PLANS` in
`packages/shared/src/constants.ts` **exactly**, or purchases fail with
"That membership is not available on this device."

**[you] App Store Connect → Subscriptions.** One group containing both:

| Product ID | Price | Duration |
| --- | --- | --- |
| `getfit_membership_monthly` | $4.99 | 1 month |
| `getfit_membership_yearly` | $19.99 | 1 year |

Rank the yearly plan higher in the group so an upgrade takes effect
immediately. Add **no** introductory offer — GetFit has no free trial, and the
"was $40" is our own discount, not a store offer.

**[you] Play Console → Monetise → Subscriptions.** The same two IDs, each with
a base plan at the matching price. Android requires an **active** base plan
offer; without one `getSubscriptions` returns a product with no offer token and
the purchase cannot start.

---

## 4. Publish the privacy policy and support page

**[you]** Fill in every placeholder in `PRIVACY.md`, host it at a public HTTPS
URL, and enter that URL in **three** places: App Store Connect, Play Console,
and `app.json` under `extra.legal.privacyPolicyUrl`.

That third one is not optional. Guideline 3.1.2 requires an auto-renewable
subscription app to carry a **working link to the privacy policy inside the
binary**, on the purchase screen. The paywall and Settings render it from that
field; a blank field means a release build refuses to start.

**[you]** You also need a support page at a public HTTPS URL — App Store Connect
requires one. Put it in `app.json` under `extra.legal.supportUrl`. An email
address on a plain page is enough.

If you host your own terms rather than using Apple's standard EULA, fill in
`TERMS.md` the same way and set `extra.legal.termsOfUseUrl`.

### App privacy answers (App Store Connect)

Answer these to match what the app does:

| Question | Answer |
| --- | --- |
| Health & Fitness data collected | **Yes** — linked to identity, app functionality |
| Photos collected | **Yes** — linked to identity, app functionality (optional progress photos) |
| Contact info (email) | **Yes** — linked to identity, app functionality |
| Purchases | **Yes** — linked to identity |
| Used for tracking | **No** |
| Used for third-party advertising | **No** |
| Data used to train models | **No** — nothing is sent to any model |

---

## 5. Build and test the purchase flow

**This is the step that cannot be skipped.** In-app purchases have never run on
a real device in this project. The store adapter is written against
`react-native-iap` and compiles, but no sandbox purchase has been made.

**In-app purchases cannot be tested in Expo Go.** `react-native-iap` is a
native module, so Expo Go falls back to the mock store. You need a real build:

```bash
cd packages/mobile
eas build --platform ios --profile preview     # [you] internal distribution
```

On the device, **sign out of the App Store first** (Settings → your name →
Media & Purchases → Sign Out). The sandbox prompt appears at purchase time.
Sandbox subscriptions renew on a compressed clock — a month is 5 minutes, a
year is an hour — so renewal and expiry are testable in one sitting.

**[you]** With a sandbox tester account signed in, verify each of:

- [ ] Both plans appear with the right prices; yearly shows **$40 struck
      through**, **$20**, and the **BEST DEAL** badge
- [ ] Buying monthly grants access; the server records `$5` and a one-month period
- [ ] Buying yearly grants access; the server records `$20` and a one-year period
- [ ] Cancelling the sheet shows "Purchase cancelled", not an error
- [ ] **Restore purchase** works on a second device with the same Apple ID
- [ ] The transaction is **finished** — it must not reappear on relaunch
- [ ] An expired membership blocks the app and shows the renewal screen
- [ ] **Manage or cancel in App Store** opens Apple's subscription settings —
      the app never cancels a store subscription itself
- [ ] Settings → Membership shows the plan you actually bought, not always $5/month
- [ ] The paywall shows the price, the period, the auto-renewal wording and
      working **Privacy Policy** and **Terms of Use** links
- [ ] Settings → Health disclaimer opens and reads correctly
- [ ] An assessment completes with **measurements only and no photo**
- [ ] An assessment with no tape reading is labelled **Estimated**, not Measured
- [ ] Symmetry reads **Not measured** when no limb pair was entered
- [ ] Camera and photo-library permission prompts appear with our wording
- [ ] Account deletion removes everything and signs you out

---

## 6. Submit

```bash
cd packages/mobile
npm run preflight -- --profile production   # must pass before you spend build minutes
eas build --platform ios --profile production
eas submit --platform ios --profile production   # [you] Apple credentials + 2FA
```

**[you]** Still required in App Store Connect, and none of it can be automated:

- Apple Developer Program membership ($99/year)
- App record, bundle ID `com.getfit.app`, and the `ascAppId` in `eas.json`
- **Screenshots** — 6.7" and 6.5" iPhone, captured on a real device or
  simulator. Good six: the hologram result, the measurements screen, Home, a
  guided workout, Progress, and the paywall
- Description, keywords, support URL, marketing URL
- **Age rating: 12+.** Answer "Infrequent/Mild" to *Medical/Treatment
  Information* — the app reports body-composition estimates — and "None" to
  every other category
- **Export compliance:** already answered. `ITSAppUsesNonExemptEncryption` is
  `false` in `app.json`, because the app uses only HTTPS, which is exempt
- A **sandbox account for the reviewer**, and the review notes below

### Reviewer notes (paste into App Review Information)

> GetFit calculates body composition from tape measurements and builds a
> training program around it.
>
> To review the full flow: complete onboarding and enter any plausible waist
> and neck measurement (for example 85 cm and 38 cm) on the measurements
> screen, then view the analysis. The analysis is shown **before** any payment
> is requested. A membership is then required to generate a training program.
>
> The measurements are optional — continuing without them produces a
> height-and-weight estimate that the app labels "Estimated" rather than
> "Measured". The body-fat figure comes from the published US Navy
> circumference formula computed on our own server; **no third-party service,
> AI or otherwise, receives any user data.**
>
> The progress photo is entirely optional and is **never analysed**. It is
> stored privately so the user has a before/after reference, is never shown to
> other users, and is never displayed in the app's Progress or History screens.
> You can complete the whole review without taking one. Account deletion is
> available in Settings → Privacy & data and removes all photos and data
> immediately.
>
> Subscriptions are managed entirely by the App Store. Settings → Membership
> opens Apple's subscription settings rather than cancelling in-app, because
> Apple owns the billing relationship. The paywall carries the price, the
> period, the auto-renewal terms and links to our privacy policy and terms.
>
> There is no free trial. Pricing is $4.99/month or $19.99/year.

---

## What is already handled

Not a to-do list — these are done, and listed so you do not redo them:

- **Privacy manifest** (`app.json` → `ios.privacyManifests`), declaring the
  collected data types and the required-reason APIs. Apple rejects uploads
  without one
- **Guideline 3.1.2 disclosures** on the paywall: title, length, price,
  auto-renewal wording, and in-binary privacy and terms links
- **Subscription management** routed to the store, never cancelled in-app
- **Account deletion** in Settings → Privacy & data, with a two-step
  confirmation — Guideline 5.1.1(v)
- **Restore purchase** on the paywall, verified server-side
- **Health disclaimer** in Settings → About
- **Specific permission strings** for camera and photo library
- **Export compliance** answered in `app.json`

---

## Known gaps

Honest list of what has **not** been verified, so nothing is assumed:

- **No purchase has ever completed on a device.** The IAP adapter is written
  and type-checked but never exercised against StoreKit or Play Billing.
- **The S3 photo driver has never run against a real bucket.** Its key scoping
  and encryption settings are implemented but untested.
- **The optional remote vision provider has never been connected.** It is not
  needed — the built-in measurement analyser is the default — but its request
  and response handling has only been exercised against a stub.
- The app has not been run on a physical device or simulator — it is verified
  by an automated test suite, type checking and a clean production bundle.
- **No screenshots exist.** They have to be captured from a running build and
  are a required field in App Store Connect.
