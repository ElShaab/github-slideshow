import React, { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { GlassButton, PrimaryButton, Screen, Text } from '../../components';
import { ApiError } from '../../api/client';
import { authApi } from '../../api/endpoints';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'SignIn'>;

/** Sign-in for returning users on a new device. */
export function SignInScreen({ navigation }: Props): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
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
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [email, password, refresh]);

  const inputStyle = [
    styles.input,
    {
      color: colors.text,
      borderColor: colors.glassBorder,
      backgroundColor: colors.glass,
      borderRadius: radius.md,
    },
  ];

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
        <View>
          <Text variant="micro" color="muted" uppercase>
            Email
          </Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            accessibilityLabel="Email address"
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            style={inputStyle}
          />
        </View>

        <View>
          <Text variant="micro" color="muted" uppercase>
            Password
          </Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            accessibilityLabel="Password"
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            style={inputStyle}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    minHeight: 56,
  },
});
