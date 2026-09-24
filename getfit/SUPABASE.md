# Supabase setup

GetFit stores everything on the device and works with no network at all. An
account adds one thing: the data survives a lost phone and follows the user to
the next one. This is how to turn that on.

**A build with no Supabase project configured is a supported configuration.**
The app then behaves exactly as it did before accounts existed — the sync layer
returns early everywhere and no screen changes. Nothing here is required to ship.

## 1. Create the tables

In the Supabase dashboard, open **SQL Editor** and run
[`supabase/migrations/0001_user_data.sql`](supabase/migrations/0001_user_data.sql)
as it is. It is idempotent, so running it twice is safe.

It creates nine tables, mirroring the four documents the app keeps on the
device, and enables row-level security on every one of them with a single
policy: a row belongs to one account, and only that account may read or write
it. Anonymous callers are refused outright.

To check it took, run this afterwards — every row must say `true`:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

## 2. Turn on email sign-in, and make it send a code

**Authentication → Sign In / Providers → Email.** The app uses email and
password; no other provider is wired up.

Two settings decide whether account setup works at all.

### The email must carry a code, not a link

Account setup asks for a six-digit code. Supabase sends a **magic link** unless
the template says otherwise, and a link cannot be typed into the code field —
the screen would be unusable.

Three templates need it, because Supabase picks between them by situation: a
brand-new address, a returning one, and a password reset. Edit all three —
**Confirm signup**, **Magic Link** and **Reset Password** — under
**Authentication → Emails**. Each body must include `{{ .Token }}`:

```html
<p>Your GetFit code is <strong>{{ .Token }}</strong>.</p>
<p>It expires in an hour. If you didn't ask for it, ignore this email.</p>
```

Any template left on the default `{{ .ConfirmationURL }}` sends a link instead,
and whoever hits that path is stuck on a screen they cannot complete — for
signup that is a customer who has just paid, and for reset it is one who cannot
reach training they are still being billed for.

Quickest check: put your own address through signup and through "Forgot your
password?". A six-digit number in the inbox means both are right; a button or a
link means one template is still on the default.

### The default email service will not carry your users

Supabase's built-in SMTP is rated for a handful of messages an hour and is
documented as being for development only. Setup happens **immediately after
payment**, so a rate-limited email is a customer who has been charged and
cannot finish — the worst moment to fail.

Before launch, set a real provider under **Project Settings → Authentication →
SMTP Settings** (Resend, Postmark, SES — any of them). Then raise the limit
under **Authentication → Rate Limits**.

This is the single most likely thing to break this flow in production, and it
is configuration rather than code.

## 3. Point the app at the project

Copy `packages/mobile/.env.example` to `packages/mobile/.env` and fill in:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxxxx
```

Both come from **Project Settings → API Keys**. Use the **publishable**
(`sb_publishable_…`) key, not the legacy anon JWT — the app warns in development
if it sees a JWT there.

**Never put the secret / service-role key in the app.** It bypasses row-level
security entirely, and `EXPO_PUBLIC_` values are inlined into the JavaScript
bundle, which anyone can unpack.

`.env` is gitignored. This repository is public, so the key is deliberately kept
out of it even though a publishable key is designed to ship inside the app — it
grants nothing without a signed-in user, but keeping it in the build environment
means it can be rotated without a commit.

**Clear the Metro cache after editing `.env`.** These values are substituted
into the bundle at build time, and Metro caches the transformed module by file
content — which `.env` is not part of. Editing it and rebuilding gives you the
previous values with no warning. Verified, not assumed: the same build produced
an empty config until the cache was reset, then the right one.

```sh
npx expo start --clear
# or, for the Xcode path
npx expo export:embed --reset-cache --platform ios --entry-file packages/mobile/index.js \
  --bundle-output /dev/null --assets-dest /tmp/getfit-assets
```

A release build also refuses to start when these are missing, naming them on the
misconfiguration screen, so a build without them cannot be submitted by mistake.

### For EAS builds

`EXPO_PUBLIC_` variables must exist in the build environment to be inlined, and
`eas.json` is committed, so they go in EAS rather than in the file:

```sh
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://your-project.supabase.co --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value sb_publishable_xxx --environment production --visibility plaintext
```

`plaintext` is right here: the value ends up readable inside the app either way,
and marking it secret would only hide it from the build logs.

## Checking it actually works

```sh
npm run supabase:check --workspace @getfit/mobile
```

Reads the same two variables the app does, from the environment or from
`packages/mobile/.env`. It creates two throwaway accounts, has one write a
profile and a body assessment, and then checks the part that matters: that the
other account sees none of it, that a signed-out caller sees none of it, and
that neither can write into it. Then it deletes both through
`delete_own_account`, and confirms the data went with them.

It runs against the same REST and auth endpoints the app uses, so a pass means
the app's path works too. A missing table tells you the migration has not been
run; a sign-up that returns no session tells you email confirmation is on.

## How the sync behaves

- **The device is the working copy.** Every screen reads and writes local
  storage; nothing waits on a network, and a failed sync is never shown as an
  error the user has to act on.
- **History is unioned, never replaced.** Completed workouts, personal records
  and assessments are merged by id, so a session logged on either device
  survives. Assessment numbering is recomputed from the real chronological
  order.
- **The profile and the programme are last-write-wins**, with one override: a
  profile that has completed onboarding always beats one that has not, so
  signing in on a fresh install cannot wipe the account.
- **Photos are never uploaded.** The local record keeps a file path inside the
  app's private directory; that path is not synced, because it means nothing on
  another device.

## Email templates

Paste these into **Authentication → Emails → Templates**. Every one uses
`{{ .Token }}`, the six-digit code — **not** `{{ .ConfirmationURL }}`. The app's
screens ask for a code; a link cannot be typed into them, so a template left on
the default sends people a dead end.

**Three templates are used. The rest are not:**

| Template | When it fires | Used |
| --- | --- | --- |
| **Confirm signup** | the address is new — the main path after payment | yes |
| **Magic Link** | the address already has an account | yes |
| **Reset Password** | "Forgot your password?" | yes |
| Invite user | only from the dashboard, by you | no |
| Change Email Address | the app has no change-email screen | no |
| Reauthentication | not used | no |

The three share a shape on purpose: no images, no external stylesheets, one
piece of information, and everything selectable as plain text. That is also
what keeps them out of spam — an image-heavy HTML mail from a Gmail address to
a stranger is the classic profile of one.

### 1. Confirm signup

**Subject**

```
Your GetFit code is {{ .Token }}
```

**Body**

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#0A2540;max-width:480px;margin:0 auto;padding:24px;">
  <p style="font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#5A7184;margin:0 0 20px;">GetFit</p>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 12px;">Confirm your email</h1>
  <p style="margin:0 0 24px;">Enter this code in the app to finish setting up your account.</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 24px;color:#0A3B85;">{{ .Token }}</p>
  <p style="margin:0 0 24px;">It expires in one hour and can be used once.</p>
  <p style="font-size:14px;color:#5A7184;margin:0;">If you did not create a GetFit account, you can ignore this email.</p>
  <p style="font-size:13px;color:#8A9AAB;margin:28px 0 0;">GetFit · getfit.app.support@gmail.com</p>
</div>
```

### 2. Magic Link

Fires when the address already has an account. Same code, different heading —
this person is signing in, not signing up.

**Subject**

```
Your GetFit code is {{ .Token }}
```

**Body**

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#0A2540;max-width:480px;margin:0 auto;padding:24px;">
  <p style="font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#5A7184;margin:0 0 20px;">GetFit</p>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 12px;">Your sign-in code</h1>
  <p style="margin:0 0 24px;">Enter this code in the app to sign in.</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 24px;color:#0A3B85;">{{ .Token }}</p>
  <p style="margin:0 0 24px;">It expires in one hour and can be used once.</p>
  <p style="font-size:14px;color:#5A7184;margin:0;">If you did not ask to sign in, you can ignore this email. Your account is unchanged.</p>
  <p style="font-size:13px;color:#8A9AAB;margin:28px 0 0;">GetFit · getfit.app.support@gmail.com</p>
</div>
```

### 3. Reset Password

**Subject**

```
Your GetFit password reset code is {{ .Token }}
```

**Body**

```html
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#0A2540;max-width:480px;margin:0 auto;padding:24px;">
  <p style="font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#5A7184;margin:0 0 20px;">GetFit</p>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 12px;">Reset your password</h1>
  <p style="margin:0 0 24px;">Enter this code in the app, then choose a new password.</p>
  <p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:0 0 24px;color:#0A3B85;">{{ .Token }}</p>
  <p style="margin:0 0 24px;">It expires in one hour and can be used once.</p>
  <p style="font-size:14px;color:#5A7184;margin:0;">If you did not ask to reset your password, you can ignore this email. Your password stays as it is.</p>
  <p style="font-size:13px;color:#8A9AAB;margin:28px 0 0;">GetFit · getfit.app.support@gmail.com</p>
</div>
```

### Checking them

Put your own address through signup and through "Forgot your password?". Six
digits in the inbox both times means all three are right. A button or a link
means one is still on the default.

## URL Configuration

**Authentication → URL Configuration.**

Nothing in this app opens a link from an email, so these settings do not affect
it. Supabase still requires a Site URL, and the default is `http://localhost:3000`
— which is a dead address on a customer's phone and appears in any email that
falls back to a URL. Point it somewhere real instead:

| Setting | Value |
| --- | --- |
| **Site URL** | `https://elshaab.github.io/github-slideshow/privacy.html` |
| **Redirect URLs** | leave empty |

Redirect URLs exist to allow-list where a magic link may send someone. This app
never sends one, so an empty list is correct — and it is the safer default,
since an over-broad entry there is what lets an attacker redirect a real sign-in
link to a site they control.

If you ever switch to magic links, this becomes real work: an app URL scheme, an
`emailRedirectTo`, handling the incoming link, and this allow-list. That is the
cost the code flow avoids.

## Staying out of spam

The test landing in spam is not about the template. It is about who the mail is
from.

Gmail SMTP sends as `getfit.app.support@gmail.com`, and a consumer Gmail address
sending transactional mail to strangers has no domain reputation to draw on. It
is also capped around 500 messages a day and is against Gmail's terms for bulk
sending, so it will not scale past a small launch.

The real fix is a domain you own plus a transactional provider (Resend,
Postmark, SES), which gives you SPF, DKIM and DMARC aligned to that domain. That
is what inbox placement actually rests on.

Until then, these templates help as much as a template can: no images, no
external CSS, no link shorteners, no marketing language, a single clear purpose,
and everything readable as plain text. Ask your first testers to mark the first
one "not spam" — with a low-volume sender, that genuinely moves it.

## Account setup, step by step

After a successful purchase the app requires an account. It cannot be skipped:
the membership is bought, and the account is what ties it to a person rather
than to one handset.

1. **Email** — `signInWithOtp({ shouldCreateUser: true })` sends the code and
   creates the account if the address is new.
2. **Code** — `verifyOtp({ type: 'email' })` proves the address and returns a
   session. Row-level security refuses every write before this point, which is
   why nothing syncs until the code is entered.
3. **Password** — `updateUser({ password, data: { passwordSet: true } })`.

That flag matters. Verifying the code signs the user in, so being signed in is
not the same as being finished; without a password they could never sign in on
a second phone. Someone who closes the app between steps 2 and 3 comes back to
step 3 rather than starting over.

## Forgotten passwords

Reached from **Forgot your password?** on the sign-in screen, and it is the same
three steps as setting up: email, code, new password. No link, no browser, no
deep link, and no domain to own — which is what makes it work on a phone freshly
restored from backup, where the account is the only way back to the training
history.

The screen never says whether an address has an account. It reports that a code
is on its way either way, because confirming it would turn the screen into a way
to discover who has one.

## What is deliberately not here
- **Realtime.** The app syncs on sign-in, on returning to the foreground, and a
  few seconds after a local write. There is no live subscription, because
  nothing in GetFit is collaborative.
- **A service-role key anywhere.** Deleting the `auth.users` row needs one, and
  a service-role key inside a shipped binary would hand anyone who unpacked it
  the whole database. The privilege lives in the `delete_own_account()` function
  in the migration instead: `security definer`, no parameters, and it can only
  delete the row belonging to `auth.uid()`. Every table cascades from it, so
  account deletion leaves nothing behind, email address included.
