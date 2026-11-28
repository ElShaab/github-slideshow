import { Platform } from 'react-native';
import {
  MockStoreProvider,
  NativeStoreProvider,
  type DeviceOs,
  type IapModule,
  type StoreProvider,
} from './storeAdapter';

/**
 * The platform binding for the store adapter.
 *
 * This file exists to answer two questions the adapter deliberately does not
 * ask: which OS is running, and where the native billing module lives. Every
 * decision about purchases is in `storeAdapter.ts`, where it can be tested
 * without a device.
 */
export * from './storeAdapter';

const deviceOs: DeviceOs = Platform.OS === 'ios' ? 'ios' : 'android';

/**
 * Resolves react-native-iap at runtime, so the bundle still runs in Expo Go
 * where no billing native code is linked.
 */
function resolveIapModule(): IapModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-iap') as IapModule;
  } catch {
    return null;
  }
}

/**
 * One native provider for the whole app.
 *
 * The adapter holds the billing connection and the store's purchase listener,
 * so a second instance would mean a second connection and a transaction
 * delivered to whichever one registered last. There is one store, so there is
 * one adapter — and it stays alive for the life of the app, which is how a
 * transaction the store could not deliver earlier still reaches us.
 */
let nativeProvider: NativeStoreProvider | null = null;

export function sharedNativeProvider(): NativeStoreProvider {
  if (!nativeProvider) nativeProvider = new NativeStoreProvider(deviceOs, resolveIapModule);
  return nativeProvider;
}

export function createStoreProvider(options: {
  mockAvailable: boolean;
  scenario?: string;
}): StoreProvider {
  const native = sharedNativeProvider();
  if (native.available) return native;
  if (options.mockAvailable) return new MockStoreProvider(options.scenario);
  return native;
}
