/**
 * Attaching the StoreKit configuration to the Xcode Run scheme.
 *
 * This is the difference between a paywall that opens a purchase sheet and one
 * that fails with "That membership is not available on this device", and it is
 * a file Xcode refuses to open if the XML comes out wrong — so the transform
 * is tested rather than eyeballed.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

// A CommonJS module because `expo prebuild` requires its plugins, and the
// script that edits the scheme and this test have to be the same one.
const plugin = createRequire(__filename)('../plugins/withStoreKitConfiguration') as {
  attachStoreKitConfiguration: (xml: string, identifier: string) => string;
  detachStoreKitConfiguration: (xml: string) => string;
};
const { attachStoreKitConfiguration, detachStoreKitConfiguration } = plugin;

/** A scheme shaped like the one `expo prebuild` generates. */
const SCHEME = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1430"
   version = "1.3">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
   </BuildAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintName = "GetFit">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release">
   </ProfileAction>
</Scheme>
`;

const IDENTIFIER = '../../../../GetFit.storekit';

describe('attaching the configuration', () => {
  test('names the file, so StoreKit answers locally', () => {
    const updated = attachStoreKitConfiguration(SCHEME, IDENTIFIER);
    assert.match(updated, /<StoreKitConfigurationFileReference/);
    assert.match(updated, /identifier = "\.\.\/\.\.\/\.\.\/\.\.\/GetFit\.storekit"/);
  });

  test('puts it inside the Run action, where Xcode reads it', () => {
    const updated = attachStoreKitConfiguration(SCHEME, IDENTIFIER);
    const launch = updated.indexOf('<LaunchAction');
    const close = updated.indexOf('</LaunchAction>');
    const reference = updated.indexOf('<StoreKitConfigurationFileReference');
    assert.ok(reference > launch && reference < close, 'the reference escaped the Run action');
  });

  test('leaves the Profile and Build actions alone', () => {
    const updated = attachStoreKitConfiguration(SCHEME, IDENTIFIER);
    assert.match(updated, /<ProfileAction\n {6}buildConfiguration = "Release">/);
    assert.match(updated, /buildImplicitDependencies = "YES"/);
    assert.match(updated, /BlueprintName = "GetFit"/);
  });

  test('the scheme is still well-formed XML', () => {
    const updated = attachStoreKitConfiguration(SCHEME, IDENTIFIER);
    const opened = updated.match(/<LaunchAction\b/g) ?? [];
    const closed = updated.match(/<\/LaunchAction>/g) ?? [];
    assert.equal(opened.length, 1);
    assert.equal(closed.length, 1);
    assert.equal(
      (updated.match(/<StoreKitConfigurationFileReference\b/g) ?? []).length,
      (updated.match(/<\/StoreKitConfigurationFileReference>/g) ?? []).length,
    );
  });

  test('running it twice leaves one reference, not two', () => {
    const once = attachStoreKitConfiguration(SCHEME, IDENTIFIER);
    const twice = attachStoreKitConfiguration(once, IDENTIFIER);
    assert.equal((twice.match(/<StoreKitConfigurationFileReference\b/g) ?? []).length, 1);
    assert.equal(twice, once, 'a second prebuild should be a no-op');
  });

  test('a changed path replaces the old one rather than adding to it', () => {
    const once = attachStoreKitConfiguration(SCHEME, '../../../Old.storekit');
    const twice = attachStoreKitConfiguration(once, IDENTIFIER);
    assert.equal((twice.match(/<StoreKitConfigurationFileReference\b/g) ?? []).length, 1);
    assert.doesNotMatch(twice, /Old\.storekit/);
    assert.match(twice, /GetFit\.storekit/);
  });

  test('replaces a self-closing reference too', () => {
    const selfClosed = SCHEME.replace(
      '   </LaunchAction>',
      '      <StoreKitConfigurationFileReference identifier = "../Old.storekit" />\n   </LaunchAction>',
    );
    const updated = attachStoreKitConfiguration(selfClosed, IDENTIFIER);
    assert.equal((updated.match(/<StoreKitConfigurationFileReference\b/g) ?? []).length, 1);
    assert.doesNotMatch(updated, /Old\.storekit/);
  });

  test('a path with XML metacharacters cannot break out of the attribute', () => {
    const updated = attachStoreKitConfiguration(SCHEME, '../Get"Fit&.storekit');
    assert.doesNotMatch(updated, /identifier = "[^"]*"[^>\n]/);
    assert.match(updated, /&quot;/);
    assert.match(updated, /&amp;/);
  });

  test('a scheme with no Run action is an error, not a silent no-op', () => {
    const noLaunch = SCHEME.replace(/ {3}<LaunchAction[\s\S]*?<\/LaunchAction>\n/, '');
    assert.throws(() => attachStoreKitConfiguration(noLaunch, IDENTIFIER), /LaunchAction/);
  });
});

describe('detaching it again', () => {
  test('returns the scheme to the real store', () => {
    const updated = attachStoreKitConfiguration(SCHEME, IDENTIFIER);
    assert.equal(detachStoreKitConfiguration(updated), SCHEME);
  });

  test('a scheme that never had one is left untouched', () => {
    assert.equal(detachStoreKitConfiguration(SCHEME), SCHEME);
  });
});
