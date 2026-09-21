import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { PrimaryButton, Screen, Text, TextField } from '../../components';
import { ApiError } from '../../api/client';
import { authApi } from '../../api/endpoints';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';

/**
 * Account creation, which happens after payment.
 *
 * The guest user is upgraded in place, so the analysis taken before signup
 * stays attached to the same person.
 */
export function CreateAccountScreen(): React.ReactElement {
  const { spacing } = useTheme();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
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
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [email, password, refresh]);

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
            disabled={!valid}
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
        Create an account so your program, assessments and training history follow
        you to any device.
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
