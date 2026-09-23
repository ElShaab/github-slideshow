---
layout: legal
title: Privacy Policy
description: What GetFit collects, why, and what control you have over it.
permalink: /privacy
---

<!-- Generated from the markdown in getfit/ by `npm run legal`. Do not edit. -->

**Last updated: 12 September 2026**

GetFit is operated by **Mohamed Hussein** ("we", "us"), who can be reached at
**getfit.app.support@gmail.com** about anything in this policy. It
explains what we collect, why, and what control you have over it.

---

## What we collect

### Your measurements

Your body-fat estimate is calculated on our server from the measurements you
enter — waist, neck, height, weight and, for women, hips — using published
anthropometric formulas. **No third party is involved in this calculation, and
your measurements are never sent to any AI or analysis service.**

### Progress photos (optional)

You can attach a photo to an assessment. It is entirely optional, the app works
fully without it, and **it is never analysed** — it exists only so you have a
genuine before-and-after to look back on.

- Photos are **private**. They are never public, never shared with other users,
  and never used for advertising or to train any model.
- Every photo is stored under an unguessable identifier scoped to your account.
  There is no public URL and no shareable link.
- Reading a photo requires being signed in as the account that owns it. The
  lookup itself is scoped by account, so there is no path that serves someone
  else's photo.
- **Photos are never displayed in the app's Progress or History screens.** Past
  assessments are shown as numbers and as a generated 3D figure, never as the
  original photograph.

### Body and health information

Calculated from the details you enter: estimated body fat percentage, estimated
muscle mass, waist-to-height ratio, a left/right balance score, your tape
measurements, height, weight, age and sex.

This is **health-related personal data**. Where GDPR applies it is a special
category of data under Article 9, processed on the basis of your explicit
consent, which you give by entering your measurements and running an analysis.
You can withdraw that consent at any time by deleting your account.

### Training data

Your program, the workouts you complete, the weights and repetitions you log,
personal records, and your goals.

### Account and subscription data

Your email address and a hashed password (we never store your password itself).
For subscriptions we store the store's transaction identifier, which plan you
bought, and when the period ends.

**We never see or store your payment details.** All payments are handled by
Apple or Google. We only ever receive a receipt confirming that a purchase
happened, which our server verifies directly with the store.

### Technical data

Standard server logs: IP address, request paths, timestamps and error details.
GetFit contains **no third-party analytics, advertising or tracking SDKs**, and
does not track you across other apps or websites.

---

## Why we process it

| Purpose | Data used | Legal basis (GDPR) |
| --- | --- | --- |
| Estimating your body composition | Measurements, height, weight, age, sex | Explicit consent (Art. 9(2)(a)) |
| Keeping your optional progress photo | Photo | Explicit consent (Art. 9(2)(a)) |
| Building and progressing your program | Body metrics, training history, goals | Contract |
| Running your membership | Email, subscription record | Contract |
| Keeping the service secure and working | Technical data | Legitimate interests |

---

## Who else processes your data

We use these subprocessors, and nothing else:

| Subprocessor | What it handles |
| --- | --- |
| **Fly.io** | Runs the API, the database and the volume photos are stored on |
| **Apple** / **Google** | Process payments and confirm subscription status |

There is **no third-party object storage**. Photos are written to an encrypted
volume attached to the same machine that runs the API, under an unguessable
name scoped to your account — they are never handed to another provider.

There is **no AI or image-analysis subprocessor**. Body composition is computed
on our own server from your measurements, and your photos are never sent
anywhere for analysis.

We do **not** sell your personal information, and we do not share it for
cross-context behavioural advertising.

---

## How long we keep it

- **Photos and assessments:** until you delete your account, or delete the
  individual assessment.
- **Training history:** until you delete your account.
- **Account and subscription records:** until you delete your account, except
  where we must keep a transaction record for tax or accounting purposes.
- **Server logs:** 30 days, then deleted automatically.

## Deleting everything

**Settings → Privacy & data → Delete account.**

This is immediate and permanent. It erases your profile, every photo file, every
assessment, your whole training history, your goals and your subscription
record. Nothing is retained in a recoverable form, and there is no grace period.

Deleting your GetFit account does **not** cancel your subscription — Apple and
Google own that relationship. Cancel it in your App Store or Play Store account
settings, or you will continue to be billed.

## Your rights

Depending on where you live you may have the right to access, correct, export,
delete or restrict processing of your data, and to object to it. Most of this is
available directly in the app; for anything else, contact us and we will respond
within the period the law requires.

Where GDPR applies you also have the right to complain to your local supervisory
authority.

## Children

GetFit is not intended for anyone under 16, and we do not knowingly collect data
from children. If you believe a child has given us data, contact us and we will
delete it.

## Security

Traffic is encrypted in transit. Passwords are hashed with bcrypt. Photos are
stored in a private bucket, encrypted at rest, and served only to their owner
through an authenticated, ownership-checked request. Database credentials and
API keys are held as deployment secrets, never in source control.

No system is perfectly secure, but we will notify affected users and the
relevant authority without undue delay if a breach puts your data at risk.

## Changes

If we change this policy materially we will update the date above and notify you
in the app before the change takes effect.

## Contact

**getfit.app.support@gmail.com**

Mohamed Hussein, operator of GetFit. Write to us at that address about
anything here, including a request to see or delete what we hold.
