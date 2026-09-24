import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
 * Three steps: the address, the code that proves it, then a password. It can be
 * postponed, and deliberately so: every step needs the network, and a customer
 * who has just paid and has no signal must not be held on a screen they cannot
 * complete. The membership does not depend on this — entitlement comes from the
 * store and is cached on the device — so the app opens either way and asks
 * again tomorrow.
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
  // This screen appears two ways: as the stage the app is held at after
  // payment, and pushed from Settings by someone coming back to finish. Pushed,
  // a refresh changes no stage and would leave them on a screen with no way
  // off, so anything that ends the flow steps back when there is a back to
  // step to.
  const navigation = useNavigation();
  const leave = useCallback(async () => {
    // Always refresh: it is what moves the stage on when this screen is the
    // gate, and what stops Settings still offering to create an account that
    // now exists. Then step back, if there is anywhere to step back to.
    await refresh();
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation, refresh]);

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

  const later = useCallback(async () => {
    setBusy(true);
    try {
      await authApi.deferAccount();
      await leave();
    } catch (caught) {
      show(caught);
      setBusy(false);
    }
  }, [leave, show]);

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
      await leave();
    } catch (caught) {
      show(caught);
    } finally {
      setBusy(false);
    }
  }, [leave, password, show]);

  const { title, subtitle, body, action, canSubmit } = useMemo(() => {
    if (state.step === 'code') {
      return {
        title: 'Check your email',
        subtitle: `Enter the ${CODE_LENGTH}-digit code we sent to ${state.email}.`,
        canSubmit: isValidCode(code),
        action: { label: 'Verify', onPress: verifyCode },
        body: (
          <>
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
            {/* GetFit sends from a Gmail address until it has a domain of its
                own, so the first email to a given person lands in spam often
                enough to be worth saying out loud. Someone who does not find
                it assumes the app is broken. */}
            <Text variant="caption" color="muted">
              Can&apos;t find it? Check your spam folder.
            </Text>
          </>
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

          {/* Always offered. The one step where postponing costs something is
              the password — that account is signed in but cannot sign in
              anywhere else — and the app asks about that one on every launch
              rather than waiting a day. */}
          <GlassButton
            label="I'll do this later"
            onPress={() => void later()}
            disabled={busy}
            fullWidth
          />
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
