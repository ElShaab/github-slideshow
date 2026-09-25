# GetFit Privacy Policy

**Last updated: 25 September 2026**

> **Before publishing:** host this at a public HTTPS URL and enter that URL in
> App Store Connect and Play Console. This document describes what the software
> actually does; it is not legal advice, and it should be reviewed by a lawyer
> before you rely on it — particularly for GDPR, UK GDPR and CCPA obligations,
> which depend on where you and your users are.

GetFit is operated by **Mohamed Hussein** ("we", "us"), who can be reached at
**getfit.app.support@gmail.com** about anything in this policy. It
explains what we collect, why, and what control you have over it.

---

## The short version

Your body analysis is calculated on your phone and your progress photos never
leave it. You can see your analysis and try the app without an account.

When you take out a membership we ask you to create one: an email address, a
code we send to check it is yours, and a password. That is what ties the
membership to you rather than to one handset, and it is what puts your training
data somewhere it survives a lost phone. The database is run by Supabase, and
every row in it is locked to your account.

---

## What we collect

### Your measurements

Your body-fat estimate is calculated **on your phone** from the measurements you
enter — waist, neck, height, weight and, for women, hips — using published
anthropometric formulas. **No third party is involved in this calculation, and
your measurements are never sent to any AI or analysis service.**

### Progress photos (optional)

You can attach a photo to an assessment. It is entirely optional, the app works
fully without it, and **it is never analysed** — it exists only so you have a
genuine before-and-after to look back on.

- **Photos never leave your phone.** They are not uploaded, not backed up by us,
  and not synced to your account. They are stored in GetFit's private storage
  area on the device, which other apps cannot read.
- Because they stay on the device, a photo does **not** follow you to a new
  phone, and deleting the app deletes it.
- Photos are never public, never shared with other users, and never used for
  advertising or to train any model.
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
You can withdraw that consent at any time by deleting your account, which also
erases the data from the device.

### Training data

Your program, the workouts you complete, the weights and repetitions you log,
personal records, and your goals.

### Account data

Your email address and a password, collected when you take out a membership.
**We never see your password.** It is handled and hashed by Supabase Auth; what
GetFit receives is a session token, which is kept in your phone's keychain.

We email you a short code to check the address is yours. We do this so that the
membership you paid for can be returned to you on a new phone — an address we
cannot reach is an account you could be locked out of.

Before you subscribe, no account exists and nothing is transmitted.

### Subscription data

Which plan you bought and when the period ends, read from the App Store or Play
Store on the device.

**We never see or store your payment details.** All payments are handled by
Apple or Google, and GetFit checks your membership with the store directly from
your phone.

### Technical data

GetFit contains **no third-party analytics, advertising or tracking SDKs**, and
does not track you across other apps or websites. When you have an account,
Supabase records standard service logs — IP address, timestamps, and which
requests were made — as part of running the database.

---

## Where your data is

| | Before you subscribe | With a membership |
| --- | --- | --- |
| Measurements and assessments | On your phone | On your phone **and** in your account |
| Program and training history | On your phone | On your phone **and** in your account |
| Progress photos | On your phone | On your phone **only** — never uploaded |
| Email address | Not collected | In your account |
| Password | Not collected | Hashed by Supabase; never seen by us |
| Payment details | Never collected | Never collected |

The app keeps its own copy on the device at all times, which is why it works
with no signal. When you have an account, that copy is synchronised with the
database in the background.

---

## Why we process it

| Purpose | Data used | Legal basis (GDPR) |
| --- | --- | --- |
| Estimating your body composition | Measurements, height, weight, age, sex | Explicit consent (Art. 9(2)(a)) |
| Keeping your optional progress photo | Photo | Explicit consent (Art. 9(2)(a)) |
| Building and progressing your program | Body metrics, training history, goals | Contract |
| Keeping your data across devices | Email, training data, assessments | Contract |
| Keeping the service secure and working | Technical data | Legitimate interests |

---

## Who else processes your data

We use these subprocessors, and nothing else:

| Subprocessor | What it handles |
| --- | --- |
| **Supabase** | Hosts the database your account's data is stored in, and handles sign-in |
| **Apple** / **Google** | Process payments and confirm subscription status |

Your account's data is held in the region the GetFit Supabase project is hosted
in. Supabase publishes its own infrastructure providers, subprocessors and
security practices at supabase.com/privacy.

There is **no third-party object storage** and no photo hosting of any kind,
because photos are never uploaded.

There is **no AI or image-analysis subprocessor**. Body composition is computed
on your own phone from your measurements, and your photos are never sent
anywhere for analysis.

We do **not** sell your personal information, and we do not share it for
cross-context behavioural advertising.

---

## How long we keep it

- **Photos:** on your phone until you delete the assessment or the app. We never
  hold a copy.
- **Assessments and training history:** until you delete your account.
- **Account record:** until you delete your account.
- **Subscription records:** held by Apple or Google, not by us.
- **Supabase service logs:** kept for Supabase's own retention period as part of
  running the database.

## Deleting everything

**Settings → Privacy & data → Delete account.**

This is immediate and permanent. It erases your profile, every assessment, your
whole training history and your goals — both from this phone and from our
database — and signs you out. Your photos are deleted with the device data.
Nothing is retained in a recoverable form, and there is no grace period.

If the deletion cannot reach our database — for example because you are
offline — the app tells you so and **does not** delete the local copy, so that
you are never told your data is gone while it is still stored. Try again when
you have a connection.

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

Traffic between the app and the database is encrypted in transit with TLS. Every
table is protected by row-level security, which means the database itself
refuses to return one account's rows to another — access is not something the
app is trusted to enforce on its own. Passwords are handled and hashed by
Supabase Auth and are never seen by GetFit. Your session token is stored in the
device keychain, not in ordinary app storage. Photos are never transmitted at
all.

No system is perfectly secure, but we will notify affected users and the
relevant authority without undue delay if a breach puts your data at risk.

## Changes

If we change this policy materially we will update the date above and notify you
in the app before the change takes effect.

## Contact

**getfit.app.support@gmail.com**

Mohamed Hussein, operator of GetFit. Write to us at that address about
anything here, including a request to see or delete what we hold.
