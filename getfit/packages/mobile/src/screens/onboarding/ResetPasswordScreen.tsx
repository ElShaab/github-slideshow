import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { GlassButton, PrimaryButton, Screen, Text, TextField } from '../../components';
import { ApiError } from '../../api/client';
import { AuthError } from '../../supabase/auth';
import { authApi } from '../../api/endpoints';
import {
  CODE_LENGTH,
  cleanCode,
  isValidCode,
  isValidEmail,
  nextStep,
  passwordProblem,
  type AccountSetupState,
} from '../../state/accountSetup';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'ResetPassword'>;

/**
 * Getting back in after forgetting the password.
 *
 * The same three steps as setting the account up, and deliberately so: the
 * email, the code that proves it, a new password. Nothing here needs a link or
 * a browser, which is what makes it work on a phone that has just been
 * restored from backup.
 *
 * With an account now required after payment, this is the only way back for
 * someone whose training history is in an account they cannot open. It is not
 * a convenience.
 */
export function ResetPasswordScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { refresh } = useSession();

  const [state, setState] = useState<AccountSetupState>({ step: 'email', email: '' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback((caught: unknown) => {
    setError(
      caught instanceof AuthError || caught instanceof ApiError
        ? caught.message
        : 'Something went wrong.',
    );
  }, []);

  const sendCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await authApi.sendPasswordResetCode(email);
      setState((current) => nextStep(current, { type: 'code-sent', email }));
      // Worded so it says nothing about whether that address has an account.
      // Confirming it would turn this screen into a way to discover who has one.
      setNotice(`If ${email.trim()} has an account, a ${CODE_LENGTH}-digit code is on its way.`);
    } catch (caught) {
      show(caught);
    } finally {
      setBusy(false);
    }
  }, [email, show]);

  const verifyCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await authApi.verifyPasswordResetCode(state.email, code);
      setState((current) => nextStep(current, { type: 'code-verified' }));
    } catch (caught) {
      show(caught);
    } finally {
      setBusy(false);
    }
  }, [code, show, state.email]);

  const choosePassword = useCallback(async () => {
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // The recovery code already signed them in, so this sets the password and
      // pulls the account's data down in the same step.
      await authApi.completeAccount(password);
      await refresh();
    } catch (caught) {
      show(caught);
    } finally {
      setBusy(false);
    }
  }, [password, refresh, show]);

  const { title, subtitle, body, action, canSubmit } = useMemo(() => {
    if (state.step === 'code') {
      return {
        title: 'Check your email',
        subtitle: `Enter the ${CODE_LENGTH}-digit code we sent to ${state.email}.`,
        canSubmit: isValidCode(code),
        action: { label: 'Verify', onPress: verifyCode },
        body: (
          <TextField
            label="Code"
            value={code}
            onChangeText={(value) => setCode(cleanCode(value))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            placeholder="123456"
            maxLength={CODE_LENGTH}
          />
        ),
      };
    }

    if (state.step === 'password') {
      return {
        title: 'Choose a new password',
        subtitle: 'Then your program and history come back to this phone.',
        canSubmit: passwordProblem(password) === null,
        action: { label: 'Save and sign in', onPress: choosePassword },
        body: (
          <TextField
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="At least 8 characters"
            hint="At least 8 characters."
          />
        ),
      };
    }

    return {
      title: 'Reset your password',
      subtitle: 'We will email you a code. No link to click, no browser.',
      canSubmit: isValidEmail(email),
      action: { label: 'Send code', onPress: sendCode },
      body: (
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
        />
      ),
    };
  }, [choosePassword, code, email, password, sendCode, state.email, state.step, verifyCode]);

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.md }}>
          {error ? (
            <Text variant="caption" color="danger" align="center" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : notice ? (
            <Text variant="caption" color="muted" align="center" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}

          <PrimaryButton
            label={action.label}
            onPress={() => void action.onPress()}
            loading={busy}
            disabled={!canSubmit || busy}
          />

          {state.step === 'code' ? (
            <GlassButton
              label="Use a different email"
              onPress={() => {
                setCode('');
                setNotice(null);
                setError(null);
                setState((current) => nextStep(current, { type: 'change-email' }));
              }}
              fullWidth
            />
          ) : (
            <GlassButton label="Back" onPress={navigation.goBack} fullWidth />
          )}
        </View>
      }
    >
      <Text variant="title" style={{ marginTop: spacing.giant }} accessibilityRole="header">
        {title}
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
        {subtitle}
      </Text>

      <View style={{ marginTop: spacing.xxxl, gap: spacing.lg }}>{body}</View>
    </Screen>
  );
}
