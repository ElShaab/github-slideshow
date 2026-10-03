/**
 * Adopting the UIScene life cycle, which iOS 27 makes mandatory.
 *
 * An app linked against the iOS 27 SDK with no `UIApplicationSceneManifest`
 * is trapped by UIKit as the first scene connects — EXC_BREAKPOINT at
 * UIApplicationMain, no exception, no message — while the same binary launches
 * normally on iOS 18. Expo SDK 52's template writes no manifest, so `ios/` is
 * wrong on every prebuild and the fix has to live in a plugin.
 *
 * These cover the two halves that have to agree: the class name the manifest
 * tells UIKit to look up, and the class the binary actually contains. If they
 * ever drift apart the app terminates at launch rather than failing to build.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const plugin = createRequire(__filename)('../plugins/withSceneLifecycle') as {
  withSceneDelegateClass: (contents: string) => string;
  sceneManifest: () => Record<string, unknown>;
  SCENE_DELEGATE_CLASS: string;
};
const { withSceneDelegateClass, sceneManifest, SCENE_DELEGATE_CLASS } = plugin;

/** Shaped like the AppDelegate.mm Expo SDK 52 generates. */
const APP_DELEGATE = `#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"main";
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

@end
`;

describe('scene manifest', () => {
  test('names a delegate class for the one window scene role', () => {
    const manifest = sceneManifest() as {
      UIApplicationSupportsMultipleScenes: boolean;
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: { UISceneDelegateClassName: string }[];
      };
    };

    const configurations = manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication;
    assert.equal(configurations.length, 1);
    assert.equal(configurations[0].UISceneDelegateClassName, SCENE_DELEGATE_CLASS);
  });

  test('does not offer multiple scenes', () => {
    // React Native drives one root view. A second scene would connect to a
    // delegate that hands out the same window, and iPadOS would be within its
    // rights to ask for one.
    assert.equal(sceneManifest().UIApplicationSupportsMultipleScenes, false);
  });
});

describe('scene delegate class', () => {
  test('defines the class the manifest names', () => {
    const contents = withSceneDelegateClass(APP_DELEGATE);

    // The manifest is a string UIKit looks up at launch. A rename on one side
    // is not a build error, it is a crash on every device.
    assert.match(contents, new RegExp(`@interface ${SCENE_DELEGATE_CLASS} : UIResponder`));
    assert.match(contents, new RegExp(`@implementation ${SCENE_DELEGATE_CLASS}\\b`));
  });

  test('adopts the window React Native already built', () => {
    const contents = withSceneDelegateClass(APP_DELEGATE);

    // Attaching the existing window is the whole hand-off. Building a fresh
    // one instead leaves the root view controller React Native populated
    // behind, which launches to a black screen rather than a crash.
    assert.match(contents, /window\.windowScene = windowScene;/);
    assert.match(contents, /UIApplication\.sharedApplication\.delegate/);
    assert.match(contents, /makeKeyAndVisible/);
  });

  test('keeps the AppDelegate it was given', () => {
    const contents = withSceneDelegateClass(APP_DELEGATE);

    assert.match(contents, /@implementation AppDelegate/);
    assert.match(contents, /didFinishLaunchingWithOptions/);
    assert.ok(contents.startsWith('#import "AppDelegate.h"'));
  });

  test('forwards the callbacks adopting scenes takes away', () => {
    const contents = withSceneDelegateClass(APP_DELEGATE);

    // Once a scene manifest exists UIKit stops calling
    // application:openURL:options:, where AppDelegate drives RCTLinkingManager.
    // Without forwarding, `getfit://` links stop arriving — silently.
    assert.match(contents, /scene:\(UIScene \*\)scene openURLContexts:/);
    assert.match(contents, /scene:\(UIScene \*\)scene continueUserActivity:/);
    assert.match(contents, /application:application openURL:context\.URL options:options/);
  });

  test('replaces its own earlier copy instead of stacking them', () => {
    // Prebuild runs the mod against whatever is on disk, so a second run sees
    // the output of the first. Two @implementations of one class is a
    // duplicate-symbol error at link time.
    const once = withSceneDelegateClass(APP_DELEGATE);
    const twice = withSceneDelegateClass(once);

    assert.equal(twice, once);
    assert.equal(twice.split(`@implementation ${SCENE_DELEGATE_CLASS}`).length - 1, 1);
  });

  test('refuses an AppDelegate it does not recognise', () => {
    // Silently skipping would produce a manifest naming a class the binary
    // does not contain, which fails at launch rather than at build.
    assert.throws(() => withSceneDelegateClass('// not an AppDelegate at all\n'), /@end/);
  });
});
