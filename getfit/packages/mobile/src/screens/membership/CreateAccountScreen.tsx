import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { GlassButton, PrimaryButton, Screen, Text, TextField } from '../../components';
import { ApiError } from '../../api/client';
import { AuthError, currentAccount } from '../../supabase/auth';
import { authApi } from '../../api/endpoints';
import {
  CODE_LENGTH,
  cleanCode,
  isValidCode,
  isValidEmail,
  nextStep,
  passwordProblem,
  resumeStep,
  type AccountSetupState,
} from '../../state/accountSetup';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';

/**
 * Setting up the account, after payment.
 *
 * Three steps: the address, the code that proves it, then a password. There is
 * no way past this screen — the membership is bought, and an account is what
 * ties it to a person rather than to one phone, so skipping it would leave a
 * paying customer whose training dies with the handset.
 *
 * Each step only advances on a confirmed result, never on a tap, so the code
 * screen is never shown for an email that failed to send. Someone who closes
 * the app between the code and the password comes back to the password: the
 * code signed them in, but without a password they could not sign in anywhere
 * else, which is the whole point.
 */
export function CreateAccountScreen(): React.ReactElement {
  const { spacing } = useTheme();
  const { refresh } = useSession();

  const [state, setState] = useState<AccountSetupState>({ step: 'email', email: '' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resume where they left off rather than starting the email again, which
  // would send a second code and confuse the one already in their inbox.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const account = await currentAccount();
      if (cancelled || !account) return;
      const step = resumeStep({ signedIn: true, passwordSet: account.passwordSet });
      if (step === 'password') {
        setState({ step: 'password', email: account.email ?? '' });
        setEmail(account.email ?? '');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      await authApi.sendEmailCode(email);
      setState((current) => nextStep(current, { type: 'code-sent', email }));
      setNotice(`We sent a ${CODE_LENGTH}-digit code to ${email.trim()}.`);
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
      await authApi.verifyEmailCode(state.email, code);
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
      // Sets the password, records that setup finished, and pushes everything
      // already on this phone up to the new account.
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
        title: 'Create a password',
        subtitle: 'This is how you sign in on a new phone.',
        canSubmit: passwordProblem(password) === null,
        action: { label: 'Finish', onPress: choosePassword },
        body: (
          <TextField
            label="Password"
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
      title: 'Save your progress',
      subtitle:
        'Your program, assessments and training history are on this phone. An account keeps a copy so they survive a lost phone.',
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
          ) : null}
        </View>
      }
    >
      <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.xl }}>
        Membership active
      </Text>
      <Text variant="title" style={{ marginTop: spacing.sm }} accessibilityRole="header">
        {title}
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
        {subtitle}
      </Text>

      <View style={{ marginTop: spacing.xxxl, gap: spacing.lg }}>{body}</View>
    </Screen>
  );
}
