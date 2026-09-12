# GetFit Privacy Policy

**Last updated: 12 September 2026**

> **Before publishing:** replace every `[BRACKETED]` placeholder with your real
> details, host this at a public HTTPS URL, and enter that URL in App Store
> Connect and Play Console. This document describes what the software actually
> does; it is not legal advice, and it should be reviewed by a lawyer before you
> rely on it — particularly for GDPR, UK GDPR and CCPA obligations, which depend
> on where you and your users are.

GetFit is operated by **[LEGAL ENTITY NAME]**, **[REGISTERED ADDRESS]**
("we", "us"). This policy explains what we collect, why, and what control you
have over it.

---

## What we collect

### Photos you take for body analysis

When you run a body analysis, the photo you take or choose is uploaded to our
server, analysed, and stored.

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

Derived from your photo and the details you enter: estimated body fat
percentage, estimated muscle mass, waist-to-height ratio, a symmetry score,
height, weight, age and sex.

This is **health-related personal data**. Where GDPR applies it is a special
category of data under Article 9, processed on the basis of your explicit
consent, which you give by choosing to run an analysis. You can withdraw that
consent at any time by deleting your account.

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
| Estimating your body composition | Photo, height, weight, age, sex | Explicit consent (Art. 9(2)(a)) |
| Building and progressing your program | Body metrics, training history, goals | Contract |
| Running your membership | Email, subscription record | Contract |
| Keeping the service secure and working | Technical data | Legitimate interests |

---

## Who else processes your data

We use these subprocessors, and nothing else:

| Subprocessor | What it handles |
| --- | --- |
| **[HOSTING PROVIDER]** | Runs the API and database |
| **[OBJECT STORAGE PROVIDER]** | Stores photos, encrypted at rest, in a private bucket |
| **[AI PROVIDER]** | Receives a photo to produce a body-composition estimate |
| **Apple** / **Google** | Process payments and confirm subscription status |

We do **not** sell your personal information, and we do not share it for
cross-context behavioural advertising.

> **[AI PROVIDER]** must be named explicitly, along with whether photos are
> retained by them and whether they are used for model training. If your
> provider's terms allow training on submitted content, say so plainly here —
> or choose a provider whose terms forbid it.

---

## How long we keep it

- **Photos and assessments:** until you delete your account, or delete the
  individual assessment.
- **Training history:** until you delete your account.
- **Account and subscription records:** until you delete your account, except
  where we must keep a transaction record for tax or accounting purposes.
- **Server logs:** [RETENTION PERIOD, e.g. 30 days].

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

**[SUPPORT EMAIL]**
**[LEGAL ENTITY NAME], [REGISTERED ADDRESS]**
[If you have an EU/UK representative or DPO, name them here.]
