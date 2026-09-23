import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { PrimaryButton, Screen, SecondaryButton, Text, TextField } from '../../components';
import { ApiError } from '../../api/client';
import { AuthError } from '../../supabase/auth';
import { authApi } from '../../api/endpoints';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';

/**
 * The offer of an account, made after payment.
 *
 * An account does exactly one thing: it keeps a copy of the training data off
 * the phone, so a lost or replaced device does not cost the user their history.
 * Nothing in the app is gated on it, so it is declinable — and the decline is
 * remembered, because an offer that reappears on every launch is a demand.
 *
 * Everything already on the device is pushed up as part of signing up, so the
 * analysis taken before the account existed stays attached to the same person.
 */
export function CreateAccountScreen(): React.ReactElement {
  const { spacing } = useTheme();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 8,
    [email, password],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.createAccount(email.trim(), password);
      await refresh();
    } catch (caught) {
      // AuthError carries a message written for a user — "that email already
      // has an account" is the whole point of showing it.
      setError(
        caught instanceof ApiError || caught instanceof AuthError
          ? caught.message
          : 'Something went wrong.',
      );
    } finally {
      setBusy(false);
    }
  }, [email, password, refresh]);

  const decline = useCallback(async () => {
    setDeclining(true);
    setError(null);
    try {
      await authApi.declineAccount();
      await refresh();
    } catch {
      setError('Something went wrong.');
      setDeclining(false);
    }
  }, [refresh]);

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.md }}>
          {error ? (
            <Text variant="caption" color="danger" align="center" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <PrimaryButton
            label="Create account"
            onPress={() => void submit()}
            loading={busy}
            disabled={!valid || declining}
          />
          <SecondaryButton
            label="Not now"
            onPress={() => void decline()}
            disabled={busy || declining}
            accessibilityHint="Keeps everything on this phone. You can create an account later in Settings."
          />
        </View>
      }
    >
      <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.xl }}>
        Membership active
      </Text>
      <Text variant="title" style={{ marginTop: spacing.sm }} accessibilityRole="header">
        Save your progress
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
        Your program, assessments and training history are on this phone. An account
        keeps a copy so they survive a lost phone and follow you to the next one.
      </Text>
      <Text variant="caption" color="muted" style={{ marginTop: spacing.sm }}>
        Optional — everything works without one, and your progress photos stay on this
        phone either way.
      </Text>

      <View style={{ marginTop: spacing.xxxl, gap: spacing.lg }}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
        />

        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          accessibilityHint="At least 8 characters"
          placeholder="At least 8 characters"
          hint="At least 8 characters."
        />
      </View>
    </Screen>
  );
}
