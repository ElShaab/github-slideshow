/**
 * Store receipt interpretation.
 *
 * These map a store's raw response onto entitlement, so getting them wrong
 * either gives away the product or takes away time someone paid for. The
 * Play API is stubbed at fetch level; no network or credentials are involved.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.LOG_LEVEL = 'error';

// The provider signs a real JWT before calling Play, so the service account
// needs a genuine key. This one is generated here and never leaves the test.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'billing-tests@getfit.test',
  private_key: privateKey,
});

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Serves a Play purchase resource, short-circuiting the OAuth token call. */
function stubPlay(purchase: Record<string, unknown>): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes('oauth2')
      ? { access_token: 'stub-token', expires_in: 3600 }
      : purchase;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

async function verifyPlay(purchase: Record<string, unknown>) {
  stubPlay(purchase);
  // Imported per-test so the stub is in place before the module runs.
  const { GoogleBillingProvider } = await import('../src/billing/googleBillingProvider');
  return new GoogleBillingProvider().verify({
    platform: 'google',
    receipt: 'purchase-token',
    productId: 'getfit_membership_monthly',
    packageName: 'com.getfit.app',
  });
}

const inAMonth = () => String(Date.now() + 30 * 86_400_000);
const lastWeek = () => String(Date.now() - 7 * 86_400_000);

describe('Google Play purchase mapping', () => {
  test('a paid, auto-renewing subscription is valid (#6)', async () => {
    const result = await verifyPlay({
      paymentState: 1,
      autoRenewing: true,
      startTimeMillis: lastWeek(),
      expiryTimeMillis: inAMonth(),
      orderId: 'GPA.1',
    });

    assert.equal(result.valid, true);
    assert.equal(result.revoked, false);
    assert.equal(result.cancelAtPeriodEnd, false);
  });

  test('a pending payment does not unlock the product (#6)', async () => {
    // paymentState 0 is "payment pending". A future expiry must not be enough
    // on its own, or the membership is granted before the money clears.
    const result = await verifyPlay({
      paymentState: 0,
      autoRenewing: true,
      startTimeMillis: lastWeek(),
      expiryTimeMillis: inAMonth(),
      orderId: 'GPA.2',
    });

    assert.equal(result.valid, false, 'a pending payment granted the membership');
  });

  test('turning off auto-renew keeps the paid period (#3)', async () => {
    // userCancellationTimeMillis only means auto-renew is off. The user keeps
    // what they already paid for; treating it as a revocation cut them off on
    // the spot.
    const result = await verifyPlay({
      paymentState: 1,
      autoRenewing: false,
      userCancellationTimeMillis: String(Date.now()),
      cancelReason: 0,
      startTimeMillis: lastWeek(),
      expiryTimeMillis: inAMonth(),
      orderId: 'GPA.3',
    });

    assert.equal(result.revoked, false, 'a user cancellation was treated as a revocation');
    assert.equal(result.valid, true, 'a cancelled-but-unexpired subscription lost its access');
    assert.equal(result.cancelAtPeriodEnd, true, 'the pending cancellation was not recorded');
    assert.ok(result.periodEnd.getTime() > Date.now(), 'the paid period was cut short');
  });

  test('a developer cancellation is a revocation (#3)', async () => {
    const result = await verifyPlay({
      paymentState: 1,
      autoRenewing: false,
      cancelReason: 3,
      startTimeMillis: lastWeek(),
      expiryTimeMillis: inAMonth(),
      orderId: 'GPA.4',
    });

    assert.equal(result.revoked, true, 'a refunded purchase still counted as valid');
  });

  test('an expired subscription is not valid', async () => {
    const result = await verifyPlay({
      paymentState: 1,
      autoRenewing: false,
      startTimeMillis: lastWeek(),
      expiryTimeMillis: lastWeek(),
      orderId: 'GPA.5',
    });

    assert.equal(result.valid, false);
  });
});

describe('hologram seeding (#13)', () => {
  const profile = { age: 30, sex: 'male' as const, heightCm: 180, weightKg: 82 };
  const measurements = { waistCm: 85, neckCm: 38, leftArmCm: 36, rightArmCm: 38 };

  test('the stored seed reproduces the stored geometry', async () => {
    const { MeasurementBodyAnalysisProvider } = await import(
      '../src/ai/measurementBodyAnalysisProvider'
    );
    const { buildHologramData } = await import('@getfit/shared');

    const result = await new MeasurementBodyAnalysisProvider().analyze({ measurements, profile });

    // Geometry is a pure function of the figures it draws, so rebuilding from
    // the persisted assessment must produce byte-identical geometry, seed
    // included. There is no hidden randomness left to diverge.
    const rebuilt = buildHologramData({
      bodyFatPercent: result.bodyFatPercent,
      muscleMassKg: result.estimatedMuscleMassKg,
      waistBodyRatio: result.waistBodyRatio,
      heightCm: profile.heightCm,
      sex: profile.sex,
      measurements,
    });

    assert.deepEqual(rebuilt, result.hologramData, 'the stored assessment does not rebuild');
    assert.equal(rebuilt.seed, result.hologramData.seed);
  });

  test('different bodies get different seeds, and the same body is stable', async () => {
    const { MeasurementBodyAnalysisProvider } = await import(
      '../src/ai/measurementBodyAnalysisProvider'
    );
    const provider = new MeasurementBodyAnalysisProvider();

    const [a, b, again] = await Promise.all([
      provider.analyze({ measurements, profile }),
      provider.analyze({ measurements: { ...measurements, waistCm: 96 }, profile }),
      provider.analyze({ measurements: { ...measurements }, profile }),
    ]);

    assert.notEqual(a.hologramData.seed, b.hologramData.seed, 'the seed ignored the measurements');
    assert.equal(again.hologramData.seed, a.hologramData.seed, 'the same body produced a new seed');
  });

  test('the remote provider derives geometry locally too', async () => {
    const { RemoteBodyAnalysisProvider } = await import('../src/ai/remoteBodyAnalysisProvider');

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ bodyFatPercent: 22, muscleMassKg: 35, confidence: 0.8 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    const provider = new RemoteBodyAnalysisProvider('https://ai.test', 'key');
    const result = await provider.analyze({
      measurements,
      profile,
      photo: Buffer.alloc(120_000, 3),
      contentType: 'image/jpeg',
    });

    assert.equal(result.method, 'vision', 'a photo reading must not claim the measured method');
    // The user's own tape reading wins over anything the endpoint says about it.
    assert.equal(result.waistBodyRatio, 0.472);
    assert.equal(result.hologramData.version, 1);
    assert.equal(result.hologramData.segments.length, 8);
  });
});
