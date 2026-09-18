import React, { useCallback, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRODUCT_ID,
  planPricing,
} from '@getfit/shared';
import {
  ErrorState,
  GlassButton,
  LegalLinks,
  LoadingScreen,
  PlanOptionCard,
  PrimaryButton,
  Screen,
  SubscriptionCard,
  Text,
} from '../../components';
import { ApiError } from '../../api/client';
import { subscriptionApi, type SubscriptionPlanOption } from '../../api/endpoints';
import {
  createStoreProvider,
  StorePurchaseCancelled,
  StorePurchaseDeferred,
  StoreUnavailable,
  type StoreProvider,
  type StorePurchase,
} from '../../state/billing';
import { recordDevGrant, recordPurchase } from '../../state/localEntitlement';
import { useAsync } from '../../state/useAsync';
import { useStorePrices } from '../../state/useStorePrices';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';

export interface PaywallScreenProps {
  /** Renewal shows the expired framing; paywall is the first-time offer. */
  variant?: 'paywall' | 'renewal';
}

/**
 * Acknowledges a purchase without letting a store hiccup surface as a failed
 * payment. Entitlement is already granted at this point; an unacknowledged
 * transaction is simply redelivered by the store on the next launch.
 */
async function finishQuietly(store: StoreProvider, purchase: StorePurchase): Promise<void> {
  try {
    await store.finishPurchase(purchase);
  } catch {
    // Intentionally swallowed — the store retries.
  }
}

/**
 * The membership offer: $5 a month, or $20 a year.
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
  // A purchase awaiting approval is not a failure, so it is not shown as one.
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  // An older server answers without the catalogue, so fall back to the plans
  // compiled into the app rather than showing nothing to buy.
  const options: SubscriptionPlanOption[] = useMemo(
    () => (plan.data?.plans?.length ? plan.data.plans : SUBSCRIPTION_PLANS),
    [plan.data?.plans],
  );

  // Default to the best offer, which is what the badge is pointing at.
  const selected = useMemo(
    () =>
      options.find((option) => option.productId === selectedProductId) ??
      options.find((option) => option.badge) ??
      options[0],
    [options, selectedProductId],
  );

  const store = useMemo(
    () => createStoreProvider({ mockAvailable: plan.data?.mockBillingAvailable ?? false }),
    [plan.data?.mockBillingAvailable],
  );

  // What the store will actually charge, in the customer's own currency.
  // GetFit never converts — Apple and Google set each storefront's price, and
  // the figure on screen has to be the one that gets billed.
  const { prices } = useStorePrices(
    store,
    useMemo(() => options.map((option) => option.productId), [options]),
  );

  const monthlyOption = useMemo(
    () => options.find((option) => option.period === 'month') ?? options[0],
    [options],
  );

  const pricingFor = useCallback(
    (option: SubscriptionPlanOption) =>
      planPricing(
        option,
        prices[option.productId],
        monthlyOption
          ? { plan: monthlyOption, storePrice: prices[monthlyOption.productId] }
          : null,
      ),
    [monthlyOption, prices],
  );

  const selectedPricing = selected ? pricingFor(selected) : null;

  /**
   * Writes a purchase to the on-device log, and — in development only — grants
   * the membership the mock store cannot grant itself.
   *
   * This never decides entitlement on a real build. The refresh that follows
   * asks the store again, and its answer is what unlocks the app, so nothing
   * written here can turn into a membership by itself.
   */
  const logPurchase = useCallback(
    async (purchase: StorePurchase, kind: 'purchase' | 'restore') => {
      const option = options.find((item) => item.productId === purchase.productId);
      const recordedAt = new Date().toISOString();

      await recordPurchase({
        productId: purchase.productId,
        platform: purchase.platform,
        transactionId: purchase.transactionId,
        recordedAt,
        kind,
        price: option ? pricingFor(option).price : '',
      });

      if (purchase.platform === 'mock') {
        // Expo Go links no billing module, so without this the paid product
        // is unreachable while developing. The scenario keys drive the same
        // states a real subscription can be in.
        await recordDevGrant({
          productId: purchase.productId,
          platform: 'mock',
          transactionId: purchase.transactionId,
          purchasedAt: recordedAt,
          expiresAt:
            purchase.receipt === 'mock-expired'
              ? new Date(Date.now() - 86_400_000).toISOString()
              : null,
          autoRenewing: purchase.receipt === 'mock-cancelled' ? false : null,
        });
      }
    },
    [options, pricingFor],
  );

  const buy = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const purchase = await store.purchase(selected?.productId ?? SUBSCRIPTION_PRODUCT_ID);

      // Entitlement is not granted from here. The store is asked again on the
      // refresh below, and what it reports is what unlocks the app — so a log
      // entry cannot become a membership on its own.
      await logPurchase(purchase, 'purchase');

      // Entitlement is granted, so tell the store the purchase was delivered.
      // Left unacknowledged, Google refunds it after three days and StoreKit
      // replays the transaction on every launch. A failure here must not read
      // as a failed purchase — the membership is already active — so it is
      // logged and the store retries on the next launch.
      await finishQuietly(store, purchase);
      await refresh();
    } catch (caught) {
      if (caught instanceof StorePurchaseCancelled) {
        setError('Purchase cancelled.');
      } else if (caught instanceof StorePurchaseDeferred) {
        // The customer has done everything asked of them; someone else has to
        // approve it. Telling them the purchase failed would be wrong.
        setNotice(caught.message);
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
  }, [logPurchase, refresh, selected?.productId, store]);

  const restore = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const purchase = await store.restore();
      if (!purchase) {
        setError('We could not find a previous purchase on this account.');
        return;
      }
      await logPurchase(purchase, 'restore');
      await finishQuietly(store, purchase);
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [logPurchase, refresh, store]);

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
          {notice ? (
            <Text variant="caption" color="accent" align="center" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
          <PrimaryButton
            label={isRenewal ? 'Renew membership' : 'Start membership'}
            onPress={() => void buy()}
            loading={busy}
            accessibilityHint={
              selectedPricing && selected
                ? `Subscribes at ${selectedPricing.price} per ${selected.period}`
                : undefined
            }
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

      <SubscriptionCard features={plan.data.features} style={{ marginTop: spacing.xxl }} />

      <View
        style={{ marginTop: spacing.xl, gap: spacing.md }}
        accessibilityRole="radiogroup"
        accessibilityLabel="Choose a membership"
      >
        {options.map((option) => {
          const pricing = pricingFor(option);
          return (
            <PlanOptionCard
              key={option.productId}
              label={option.period === 'year' ? 'Yearly' : 'Monthly'}
              price={pricing.price}
              listPrice={pricing.listPrice}
              periodLabel={option.period === 'year' ? '/ year' : '/ month'}
              detail={
                pricing.perMonth
                  ? `Works out at ${pricing.perMonth} a month` +
                    (pricing.savingPercent ? ` — ${pricing.savingPercent}% off monthly` : '')
                  : undefined
              }
              badge={option.badge}
              limitedTime={option.limitedTime}
              selected={selected?.productId === option.productId}
              onPress={() => setSelectedProductId(option.productId)}
            />
          );
        })}
      </View>

      {/*
        Guideline 3.1.2 requires the purchase screen to state the subscription's
        title, length and price, disclose that it renews automatically and how
        to turn that off, and carry working links to the privacy policy and
        terms of use. All of it lives here rather than in store metadata,
        because the requirement is that it is in the binary.
      */}
      <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
        <Text variant="subheading">
          GetFit Membership — {selected?.period === 'year' ? '1 year' : '1 month'} for{' '}
          {selectedPricing?.price}
        </Text>
        <Text variant="caption" color="muted">
          No free trial. Payment is charged to your {storeAccountName()} at confirmation of
          purchase. The subscription renews automatically for the same price and period unless
          auto-renewal is turned off at least 24 hours before the current period ends, and your
          account is charged for the renewal within 24 hours of that point.
        </Text>
        <Text variant="caption" color="muted">
          You can manage the subscription and turn off auto-renewal in your {storeName()} account
          settings — Settings → Membership takes you straight there. Cancelling stops the next
          renewal; the period you have already paid for is unaffected.
        </Text>
        <Text variant="caption" color="muted">
          Your membership is verified on our servers, so it works on every device you sign in to.
        </Text>
        <LegalLinks />
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
  return Platform.OS === 'ios' ? 'App Store' : 'Google Play';
}

function storeAccountName(): string {
  return Platform.OS === 'ios' ? 'Apple Account' : 'Google Play account';
}


/**
 * The full-screen renewal shown when a membership has expired. It replaces the
 * whole app until the membership is restored, which is what keeps every
 * subscription-gated feature blocked.
 */
export function RenewalScreen(): React.ReactElement {
  return <PaywallScreen variant="renewal" />;
}
