/**
 * Adopts the UIScene life cycle, which iOS 27 makes mandatory.
 *
 * An app linked against the iOS 27 SDK must declare `UIApplicationSceneManifest`
 * in its Info.plist. When it does not, UIKit runs
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` while the
 * first scene connects and traps the process — a bare `brk 0`, which surfaces
 * as EXC_BREAKPOINT at UIApplicationMain with no exception and no message.
 * The same binary launches fine on iOS 18, because older releases do not
 * enforce the requirement, so this reads as "crashes only on the newest iOS".
 *
 * Expo SDK 52 predates the requirement and its iOS template writes no scene
 * manifest, so every prebuild produces an app that cannot launch on iOS 27.
 * Expo added scene support in a much later SDK; this brings the same two
 * pieces to this one.
 *
 * The manifest alone is not enough. Declaring scenes changes who owns the
 * window: UIKit stops displaying a window that is not attached to a scene, so
 * an app that declares the manifest and stops there launches to a black
 * screen. React Native builds its window in
 * `application:didFinishLaunchingWithOptions:` (`RCTAppDelegate`'s
 * `loadReactNativeWindow:`), which still runs, and still runs first. What is
 * missing is the hand-off, so the SceneDelegate here adopts that existing
 * window rather than building a second one — replacing it would throw away the
 * root view controller React Native just populated.
 *
 * The class is appended to AppDelegate.mm rather than added as its own file
 * because a new file has to be registered in project.pbxproj to be compiled,
 * and editing that archive during prebuild is far more fragile than adding a
 * second class to a translation unit the project already builds. UIKit
 * resolves `UISceneDelegateClassName` through the Objective-C runtime, which
 * does not care which file the class came from.
 */
const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');

/** The name UIKit looks up at launch, and the name of the class below. */
const SCENE_DELEGATE_CLASS = 'SceneDelegate';

/** Markers so a later prebuild replaces the class instead of stacking copies. */
const BEGIN = '// >>> getfit: UIScene life cycle';
const END = '// <<< getfit: UIScene life cycle';

/** A block an earlier run appended, including the newline that follows it. */
const EXISTING = new RegExp(`\\n*${BEGIN}[\\s\\S]*?${END}\\n*`, 'm');

/**
 * The Info.plist value that tells iOS 27 this app adopts scenes.
 *
 * `UIApplicationSupportsMultipleScenes` stays false: nothing here expects two
 * windows, and allowing them would let iPadOS open a second scene against a
 * React Native instance that assumes one root view.
 *
 * @returns {Record<string, unknown>}
 */
function sceneManifest() {
  return {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [
        {
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: SCENE_DELEGATE_CLASS,
        },
      ],
    },
  };
}

/**
 * The SceneDelegate, as Objective-C.
 *
 * Every callback forwards to the app delegate. Adopting scenes silently moves
 * URL opening and Handoff off `UIApplicationDelegate` and onto the scene
 * delegate: `application:openURL:options:` is no longer called once a scene
 * manifest exists. AppDelegate.mm implements exactly those two methods to
 * drive RCTLinkingManager, which is what `Linking.getInitialURL` and the
 * `getfit://` scheme run on, so without this forwarding deep links would stop
 * arriving — a silent regression rather than a crash, and the kind that only
 * shows up once someone taps a link.
 */
const SCENE_DELEGATE = `${BEGIN}
// Added by plugins/withSceneLifecycle.js. iOS 27 terminates any app built
// against its SDK that does not adopt the UIScene life cycle. Edit the plugin,
// not this file: prebuild regenerates AppDelegate.mm.

@interface ${SCENE_DELEGATE_CLASS} : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@end

@implementation ${SCENE_DELEGATE_CLASS}

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions
{
  if (![scene isKindOfClass:[UIWindowScene class]]) {
    return;
  }

  UIWindowScene *windowScene = (UIWindowScene *)scene;
  id<UIApplicationDelegate> appDelegate = UIApplication.sharedApplication.delegate;
  UIWindow *window = [appDelegate respondsToSelector:@selector(window)] ? appDelegate.window : nil;

  if (window == nil) {
    // React Native normally built one during didFinishLaunchingWithOptions.
    // Reaching here means it did not, so put up an empty window rather than
    // leaving the scene with nothing to display.
    window = [[UIWindow alloc] initWithWindowScene:windowScene];
    if ([appDelegate respondsToSelector:@selector(setWindow:)]) {
      appDelegate.window = window;
    }
  }

  // The window React Native made is sized from UIScreen and attached to no
  // scene, so it would never appear. Attaching it here is the whole hand-off.
  window.windowScene = windowScene;
  window.frame = windowScene.coordinateSpace.bounds;
  self.window = window;
  [window makeKeyAndVisible];

  [self getfit_openURLContexts:connectionOptions.URLContexts];

  for (NSUserActivity *userActivity in connectionOptions.userActivities) {
    [self getfit_continueUserActivity:userActivity];
  }
}

- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  [self getfit_openURLContexts:URLContexts];
}

- (void)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity
{
  [self getfit_continueUserActivity:userActivity];
}

- (void)windowScene:(UIWindowScene *)windowScene
    didUpdateCoordinateSpace:(id<UICoordinateSpace>)previousCoordinateSpace
        interfaceOrientation:(UIInterfaceOrientation)previousInterfaceOrientation
             traitCollection:(UITraitCollection *)previousTraitCollection
{
  // RCTAppDelegate posts RCTWindowFrameDidChangeNotification from this, and
  // assigns itself as the scene delegate to receive it — an assignment that
  // never took effect, because the window had no scene to carry it. Forwarding
  // restores what that line was reaching for.
  SEL forwarded = @selector(windowScene:didUpdateCoordinateSpace:interfaceOrientation:traitCollection:);
  id<UIApplicationDelegate> appDelegate = UIApplication.sharedApplication.delegate;

  if ([appDelegate respondsToSelector:forwarded]) {
    [(id<UIWindowSceneDelegate>)appDelegate windowScene:windowScene
                               didUpdateCoordinateSpace:previousCoordinateSpace
                                   interfaceOrientation:previousInterfaceOrientation
                                        traitCollection:previousTraitCollection];
  }
}

/** Replays scene URL openings as the application callback AppDelegate implements. */
- (void)getfit_openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  UIApplication *application = UIApplication.sharedApplication;
  id<UIApplicationDelegate> appDelegate = application.delegate;

  if (![appDelegate respondsToSelector:@selector(application:openURL:options:)]) {
    return;
  }

  for (UIOpenURLContext *context in URLContexts) {
    NSMutableDictionary<UIApplicationOpenURLOptionsKey, id> *options = [NSMutableDictionary dictionary];
    options[UIApplicationOpenURLOptionsOpenInPlaceKey] = @(context.options.openInPlace);

    if (context.options.sourceApplication != nil) {
      options[UIApplicationOpenURLOptionsSourceApplicationKey] = context.options.sourceApplication;
    }
    if (context.options.annotation != nil) {
      options[UIApplicationOpenURLOptionsAnnotationKey] = context.options.annotation;
    }

    [appDelegate application:application openURL:context.URL options:options];
  }
}

/** Replays Handoff and universal links the same way. */
- (void)getfit_continueUserActivity:(NSUserActivity *)userActivity
{
  UIApplication *application = UIApplication.sharedApplication;
  id<UIApplicationDelegate> appDelegate = application.delegate;

  if (![appDelegate respondsToSelector:@selector(application:continueUserActivity:restorationHandler:)]) {
    return;
  }

  [appDelegate application:application
      continueUserActivity:userActivity
        restorationHandler:^(NSArray<id<UIUserActivityRestoring>> *_Nullable restorableObjects) {
          for (id<UIUserActivityRestoring> object in restorableObjects) {
            [object restoreUserActivityState:userActivity];
          }
        }];
}

@end
${END}`;

/**
 * Returns `contents` with the SceneDelegate appended, replacing any copy an
 * earlier prebuild left behind.
 *
 * @param {string} contents source of the generated AppDelegate.mm
 * @returns {string}
 */
function withSceneDelegateClass(contents) {
  const cleaned = contents.replace(EXISTING, '\n');

  if (!/^@end\s*$/m.test(cleaned)) {
    throw new Error(
      'This AppDelegate has no @end to append the SceneDelegate after. The Expo ' +
        'template changed shape; withSceneLifecycle needs updating rather than skipping.',
    );
  }

  return `${cleaned.replace(/\s*$/, '')}\n\n${SCENE_DELEGATE}\n`;
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withSceneLifecycle = (config) => {
  const withManifest = withInfoPlist(config, (infoPlist) => {
    infoPlist.modResults.UIApplicationSceneManifest = sceneManifest();
    return infoPlist;
  });

  return withAppDelegate(withManifest, (appDelegate) => {
    const { language } = appDelegate.modResults;

    // A Swift AppDelegate would need the class written in Swift, and the
    // manifest would need the $(PRODUCT_MODULE_NAME). prefix on the class
    // name. Stopping is better than emitting a manifest that names a class
    // the binary does not contain — that fails at launch, not at build.
    if (language !== 'objc' && language !== 'objcpp') {
      throw new Error(
        `withSceneLifecycle expected an Objective-C AppDelegate and found ${language}. ` +
          'Rewrite the SceneDelegate for that language before shipping, or the app ' +
          'will terminate at launch on iOS 27.',
      );
    }

    appDelegate.modResults.contents = withSceneDelegateClass(appDelegate.modResults.contents);
    console.log('  › AppDelegate: UIScene life cycle adopted (required by iOS 27)');

    return appDelegate;
  });
};

module.exports = withSceneLifecycle;
module.exports.withSceneDelegateClass = withSceneDelegateClass;
module.exports.sceneManifest = sceneManifest;
module.exports.SCENE_DELEGATE_CLASS = SCENE_DELEGATE_CLASS;
