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

A fresh checkout fails it with five items, and every one of them is something
only you can supply — two hosted URLs and three App Store Connect identifiers:

| What | Where it goes | Section |
| --- | --- | --- |
| Your hosted privacy policy | `app.json` → `extra.legal.privacyPolicyUrl` | 3 |
| Your support page | `app.json` → `extra.legal.supportUrl` | 3 |
| Apple ID, `ascAppId`, team ID | `eas.json` → `submit.production.ios` | 1 and 5 |

**There is no server to deploy.** GetFit reads and writes local storage, and
computes body composition and every training decision on the device. Nothing in
the app makes a network request except the App Store and Play Billing.

Your own terms are optional: leave `extra.legal.termsOfUseUrl` unset and the app
links to Apple's standard EULA, which is always live. `TERMS.md` is there if you
would rather host your own.

**None of this fails loudly on its own.** A missing privacy-policy link is a
rejection two days after upload, not a build error — so a release build that
fails these checks refuses to start and names the missing field, rather than
shipping and being rejected.

---

## 1. Turn on payments with Apple

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

## 2. Create the store products

Product IDs must match `SUBSCRIPTION_PLANS` in
`packages/shared/src/constants.ts` **exactly**, or purchases fail with
"That membership is not available on this device."

**[you] App Store Connect → Subscriptions.** One group containing both:

| Product ID | Price | Duration |
| --- | --- | --- |
| `getfit_membership_monthly` | **$5.00** | 1 month |
| `getfit_membership_yearly` | **$20.00** | 1 year |

Pick the price point that is **exactly $5.00 and $20.00** in the US storefront,
not the neighbouring $4.99 / $19.99 tiers. The app displays `priceUsd` from
`SUBSCRIPTION_PLANS`, and Guideline 3.1.2 requires the price on screen to be the
price actually charged — a $4.99 product behind a "$5" label is a mismatch.

Rank the yearly plan higher in the group so an upgrade takes effect
immediately. Add **no** introductory offer — GetFit has no free trial, and the
"was $40" is our own discount, not a store offer.

**Sell worldwide if you want to.** The paywall asks the store what it will
charge and renders that string, so a customer in the UK sees Apple's `£4.49`
and one in Japan sees `¥800`. GetFit never converts currency — Apple and Google
set each storefront's price from the point you choose above, and displaying
anything else would be the 3.1.2 mismatch again. The bundled `$5` / `$20` show
only in the moment before the store answers.

Two things follow from that:

- **The "was $40" strike-through only appears in USD storefronts.** It is our
  own claim about US pricing; converting it at a rate we invented would quote a
  price we have never charged. Everywhere else the yearly card shows the real
  saving against twelve months at that storefront's own monthly rate.
- Apple's generated local prices are *approximate* equivalents, not conversions,
  and they change when Apple adjusts its price matrix. That is expected and
  needs nothing from you.

**[you] Play Console → Monetise → Subscriptions.** The same two IDs, each with
a base plan at the matching price. Android requires an **active** base plan
offer; without one `getSubscriptions` returns a product with no offer token and
the purchase cannot start.

---

## 3. Publish the privacy policy and support page

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

## 4. Test purchases in the simulator, free

Before any of the Apple setup above, you can run real purchase flows in the
iOS Simulator with **no Apple Developer account and nothing in App Store
Connect**, using `packages/mobile/GetFit.storekit`. It carries both plans at
their real ids and prices.

```bash
cd packages/mobile
npx expo prebuild --platform ios      # once, to create the Xcode project
open ios/GetFit.xcworkspace
```

In Xcode: **Product → Scheme → Edit Scheme → Run → Options**, and set
**StoreKit Configuration** to `GetFit.storekit`. Run on a simulator and the
paywall shows both plans; buying one opens a real StoreKit sheet and completes.

The **Debug → StoreKit** menu then drives the cases that are painful to reach
any other way: expire a subscription, force a renewal, decline a purchase, turn
on Ask to Buy, or simulate an interrupted purchase. A test keeps the file's
product ids and prices matching `SUBSCRIPTION_PLANS`, because a drifted id
fails silently — the paywall simply shows nothing to buy.

This is not a substitute for a sandbox purchase on a device. StoreKit
Configuration never talks to Apple, so it cannot tell you that your products
are live, that your Paid Applications agreement is active, or that your bundle
id matches. It tells you the app handles what StoreKit sends.

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

### How sandbox is chosen

**There is no sandbox setting, and no switch to flip.** The same binary talks to
sandbox or production depending on how it was signed and who is signed in:

| Build | Store it reaches |
| --- | --- |
| Xcode run with a StoreKit config file | Neither — local simulation |
| Development, ad-hoc or TestFlight | **Sandbox**, automatically |
| Downloaded from the App Store | Production |
| Android from a Play track, licensed tester account | **Sandbox** (no charge) |

Sandbox subscriptions also renew on a compressed clock — a month is 5 minutes,
a year is an hour — so renewal and expiry are testable in one sitting. Six
renewals then stop.

**[you]** With a sandbox tester account signed in, verify each of:

- [ ] Both plans appear with the right prices; yearly shows **$40 struck
      through**, **$20**, and the **BEST DEAL** badge
- [ ] Change the device's App Store region to the UK and reopen the paywall —
      prices switch to **£**, and the $40 strike-through disappears rather than
      being converted
- [ ] Buying monthly grants access, and Settings → Membership shows `$5 / month`
- [ ] Buying yearly grants access, and Settings → Membership shows `$20 / year`
- [ ] Cancelling the sheet shows "Purchase cancelled", not an error
- [ ] **Restore purchase** works on a second device with the same Apple ID
- [ ] Let a sandbox subscription lapse (about 30 minutes at 5 minutes a
      renewal) and confirm the app **locks** — this is the one StoreKit 1 got
      wrong, so it is worth watching happen
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
- [ ] Account deletion empties the device and returns you to onboarding

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
> There is no free trial. Pricing is $5.00/month or $20.00/year.

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
- The app has not been run on a physical device or simulator — it is verified
  by an automated test suite, type checking and a clean production bundle.
- **No screenshots exist.** They have to be captured from a running build and
  are a required field in App Store Connect.
