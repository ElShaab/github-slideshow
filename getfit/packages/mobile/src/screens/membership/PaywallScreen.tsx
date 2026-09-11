import React, { useCallback, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { SUBSCRIPTION_PRODUCT_ID } from '@getfit/shared';
import {
  ErrorState,
  GlassButton,
  LoadingScreen,
  PrimaryButton,
  Screen,
  SubscriptionCard,
  Text,
} from '../../components';
import { ApiError } from '../../api/client';
import { subscriptionApi } from '../../api/endpoints';
import { createStoreProvider, StorePurchaseCancelled, StoreUnavailable } from '../../state/billing';
import { useAsync } from '../../state/useAsync';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';

export interface PaywallScreenProps {
  /** Renewal shows the expired framing; paywall is the first-time offer. */
  variant?: 'paywall' | 'renewal';
}

/**
 * The $5/month membership offer.
 *
 * The user always reaches this after seeing their body analysis. There is no
 * free trial. Purchases go through the platform store and are verified on the
 * server before anything is unlocked.
 */
export function PaywallScreen({ variant = 'paywall' }: PaywallScreenProps): React.ReactElement {
  const { spacing } = useTheme();
  const { refresh } = useSession();
  const plan = useAsync(() => subscriptionApi.plan(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const store = useMemo(
    () => createStoreProvider({ mockAvailable: plan.data?.mockBillingAvailable ?? false }),
    [plan.data?.mockBillingAvailable],
  );

  const buy = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const purchase = await store.purchase(plan.data?.productId ?? SUBSCRIPTION_PRODUCT_ID);
      // The store receipt proves nothing on its own — the server verifies it
      // and decides whether the membership is active.
      await subscriptionApi.purchase({
        platform: purchase.platform,
        receipt: purchase.receipt,
        productId: purchase.productId,
      });
      await refresh();
    } catch (caught) {
      if (caught instanceof StorePurchaseCancelled) {
        setError('Purchase cancelled.');
      } else if (caught instanceof StoreUnavailable) {
        setError(caught.message);
      } else if (caught instanceof ApiError) {
        setError(caught.message);
      } else {
        setError('Something went wrong.');
      }
    } finally {
      setBusy(false);
    }
  }, [plan.data?.productId, refresh, store]);

  const restore = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const purchase = await store.restore();
      if (!purchase) {
        setError('We could not find a previous purchase on this account.');
        return;
      }
      await subscriptionApi.restore({
        platform: purchase.platform,
        receipt: purchase.receipt,
        productId: purchase.productId,
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [refresh, store]);

  if (plan.loading) return <LoadingScreen message="Loading membership…" />;
  if (!plan.data) return <ErrorState message={plan.error ?? undefined} onRetry={plan.reload} />;

  const isRenewal = variant === 'renewal';

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
            label={isRenewal ? 'Renew membership' : 'Start membership'}
            onPress={() => void buy()}
            loading={busy}
            accessibilityHint={`Subscribes at $${plan.data.priceUsd} per month`}
          />
          <GlassButton label="Restore purchase" onPress={() => void restore()} fullWidth />
        </View>
      }
    >
      <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.xl }}>
        {isRenewal ? 'Membership expired' : 'Your analysis is ready'}
      </Text>
      <Text variant="title" style={{ marginTop: spacing.sm }} accessibilityRole="header">
        {isRenewal ? 'GetFit Membership' : 'Now let’s build your program'}
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
        {isRenewal
          ? 'Your membership has expired. Renew to get your program, guided workouts and weekly assessments back.'
          : 'Your body analysis is saved. A membership unlocks the training built around it.'}
      </Text>

      <SubscriptionCard
        features={plan.data.features}
        priceUsd={plan.data.priceUsd}
        style={{ marginTop: spacing.xxl }}
      />

      <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
        <Text variant="caption" color="muted">
          No free trial. Cancel any time from Settings or your store account.
        </Text>
        <Text variant="caption" color="muted">
          Billed monthly through {storeName()}. Your membership is verified on our
          servers, so it works on every device you sign in to.
        </Text>
        {plan.data.mockBillingAvailable ? (
          <Text variant="caption" color="warning">
            Development build: purchases run through the mock store.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

function storeName(): string {
  return Platform.OS === 'ios' ? 'the App Store' : 'Google Play';
}


/**
 * The full-screen renewal shown when a membership has expired. It replaces the
 * whole app until the membership is restored, which is what keeps every
 * subscription-gated feature blocked.
 */
export function RenewalScreen(): React.ReactElement {
  return <PaywallScreen variant="renewal" />;
}
