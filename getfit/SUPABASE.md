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

## 2. Turn on email sign-in

**Authentication → Sign In / Providers → Email.** The app uses email and
password; no other provider is wired up.

If **Confirm email** is on, `signUp` returns a user with no session, and the
first sync is refused by row-level security until the user clicks the link in
their inbox. That is correct behaviour, not a bug — but it means a user who
subscribes and then creates an account will not see their data sync until they
confirm. Decide which you want before launch.

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

## What is deliberately not here

- **Password reset.** Supabase can send a recovery email, but the link lands on
  a web page rather than back in the app, which needs a redirect URL and a deep
  link set up first. Until that exists, a forgotten password costs the user
  their cross-device copy — the data on their current phone is untouched.
- **Realtime.** The app syncs on sign-in, on returning to the foreground, and a
  few seconds after a local write. There is no live subscription, because
  nothing in GetFit is collaborative.
- **A service-role key anywhere.** Deleting the `auth.users` row needs one, and
  a service-role key inside a shipped binary would hand anyone who unpacked it
  the whole database. The privilege lives in the `delete_own_account()` function
  in the migration instead: `security definer`, no parameters, and it can only
  delete the row belonging to `auth.uid()`. Every table cascades from it, so
  account deletion leaves nothing behind, email address included.
