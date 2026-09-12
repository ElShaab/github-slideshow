# Shipping GetFit

Everything between a working checkout and an app in review. Steps marked
**[you]** need credentials or a device and cannot be automated from CI.

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

Set the secrets. The server **refuses to boot** if any of these is missing or
unsafe, which is deliberate — a misconfigured production deploy fails loudly
instead of quietly serving fabricated body analysis or free memberships:

```bash
fly secrets set \
  JWT_SECRET="$(openssl rand -base64 48)" \
  MOCK_BILLING=false \
  DEV_MODE=false \
  MOCK_AI_MODE=false \
  AI_PROVIDER=[your-provider] \
  AI_BASE_URL=https://[your-ai-endpoint] \
  AI_API_KEY=[key] \
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

## 2. Create the store products

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

## 3. Publish the privacy policy

**[you]** Fill in every placeholder in `PRIVACY.md`, host it at a public HTTPS
URL, and enter that URL in both stores. It is mandatory, and this app processes
body photos and health metrics, so expect it to be read.

### App privacy answers (App Store Connect)

Answer these to match what the app does:

| Question | Answer |
| --- | --- |
| Health & Fitness data collected | **Yes** — linked to identity, app functionality |
| Photos collected | **Yes** — linked to identity, app functionality |
| Contact info (email) | **Yes** — linked to identity, app functionality |
| Purchases | **Yes** — linked to identity |
| Used for tracking | **No** |
| Used for third-party advertising | **No** |
| Data used to train models | Answer from your AI provider's terms |

---

## 4. Build and test the purchase flow

**This is the step that cannot be skipped.** In-app purchases have never run on
a real device in this project. The store adapter is written against
`react-native-iap` and compiles, but no sandbox purchase has been made.

```bash
cd packages/mobile
eas build --platform ios --profile preview     # [you] internal distribution
```

**[you]** With a sandbox tester account signed in, verify each of:

- [ ] Both plans appear with the right prices; yearly shows **$40 struck
      through**, **$20**, and the **BEST DEAL** badge
- [ ] Buying monthly grants access; the server records `$5` and a one-month period
- [ ] Buying yearly grants access; the server records `$20` and a one-year period
- [ ] Cancelling the sheet shows "Purchase cancelled", not an error
- [ ] **Restore purchase** works on a second device with the same Apple ID
- [ ] The transaction is **finished** — it must not reappear on relaunch
- [ ] An expired membership blocks the app and shows the renewal screen
- [ ] Camera and photo-library permission prompts appear with our wording
- [ ] Account deletion removes everything and signs you out

---

## 5. Submit

```bash
cd packages/mobile
eas build --platform ios --profile production
eas submit --platform ios --profile production   # [you] Apple credentials + 2FA
```

**[you]** Still required in App Store Connect, and none of it can be automated:

- Apple Developer Program membership ($99/year)
- App record, bundle ID `com.getfit.app`, and the `ascAppId` in `eas.json`
- **Screenshots** — 6.7" and 6.5" iPhone, captured on a real device or simulator
- Description, keywords, support URL, marketing URL
- Age rating questionnaire
- A **sandbox account for the reviewer**, and review notes explaining that body
  analysis requires a photo and the program unlocks after purchase

### Reviewer notes (paste into App Review Information)

> GetFit estimates body composition from a photo and builds a training program
> around it.
>
> To review the full flow: complete onboarding, take or choose any full-body
> photo (framing does not matter — an imperfect photo lowers the confidence
> score but still analyses), then view the analysis. The analysis is shown
> **before** any payment is requested. A membership is then required to
> generate a training program.
>
> Photos are private, are never shown to other users, and are never displayed
> in the app's Progress or History screens — past assessments are shown as
> numbers and a generated figure. Account deletion is available in
> Settings → Privacy & data and removes all photos and data immediately.
>
> There is no free trial. Pricing is $4.99/month or $19.99/year.

---

## Known gaps

Honest list of what has **not** been verified, so nothing is assumed:

- **No purchase has ever completed on a device.** The IAP adapter is written
  and type-checked but never exercised against StoreKit or Play Billing.
- **The S3 photo driver has never run against a real bucket.** Its key scoping
  and encryption settings are implemented but untested.
- **No real AI provider has been connected.** Only the deterministic mock
  provider has ever produced an analysis.
- The app has not been run on a physical device or simulator — it is verified
  by an automated test suite, type checking and a clean production bundle.
