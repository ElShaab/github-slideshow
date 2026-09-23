import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { GlassButton, PrimaryButton, Screen, Text, TextField } from '../../components';
import { ApiError } from '../../api/client';
import { AuthError } from '../../supabase/auth';
import { authApi } from '../../api/endpoints';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'SignIn'>;

/** Sign-in for returning users on a new device. */
export function SignInScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.login(email.trim(), password);
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
            label="Sign in"
            onPress={() => void submit()}
            loading={busy}
            disabled={email.length === 0 || password.length === 0}
          />
          <GlassButton label="Back" onPress={navigation.goBack} fullWidth />
        </View>
      }
    >
      <Text variant="title" style={{ marginTop: spacing.giant }} accessibilityRole="header">
        Welcome back
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
        Sign in to pick your program back up where you left it.
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
          autoComplete="current-password"
          placeholder="••••••••"
        />
      </View>
    </Screen>
  );
}
