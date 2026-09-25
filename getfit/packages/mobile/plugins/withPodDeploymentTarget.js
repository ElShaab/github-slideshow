/**
 * Raises every pod target's iOS deployment target to the app's.
 *
 * Xcode 16 warns, and Xcode 27 refuses outright, when a target deploys below
 * its supported range. Several pods still declare 13.4 in their podspec —
 * RNCAsyncStorage among them — and `platform :ios` in the Podfile does not
 * override a podspec that states its own floor.
 *
 * `expo-build-properties` sets the app target and the Podfile's platform line,
 * which is necessary and not sufficient: it leaves the pod targets alone. This
 * fills that gap, and in particular covers **resource bundle targets**, which
 * are separate targets CocoaPods generates per pod and which inherit the
 * podspec's floor rather than the Podfile's platform.
 *
 * Injected into the Podfile's existing `post_install` block rather than added
 * as a second one: a Podfile stores a single post_install callback, so
 * declaring it twice silently discards the first — taking React Native's own
 * post-install work with it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

/** Markers so a second prebuild replaces the block instead of stacking them. */
const BEGIN = '    # >>> getfit: pod deployment targets';
const END = '    # <<< getfit: pod deployment targets';

/** The line that opens the Podfile's one post_install block. */
const POST_INSTALL = /^([ \t]*)post_install do \|[^|]*\|[ \t]*$/m;

/** A block we injected on an earlier run, including its trailing newline. */
const EXISTING = new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n`, 'm');

/**
 * Ruby that raises every target in every generated project.
 *
 * `generated_projects` is used where CocoaPods offers it, because with
 * `generate_multiple_pod_projects` the pods live in sibling projects and
 * `pods_project.targets` sees none of them. Resource bundles are ordinary
 * native targets inside those projects, so iterating targets covers them —
 * the reason they are missed elsewhere is that people iterate
 * `installer.pod_targets`, which is the dependency graph rather than the
 * targets Xcode builds.
 *
 * Only ever raises. A pod that needs something newer than the app keeps it,
 * because lowering it would trade a warning for a link error.
 */
function block(deploymentTarget) {
  return `${BEGIN}
    # Xcode refuses to build a target that deploys below its supported range,
    # and a podspec's own floor outlives the Podfile's platform line.
    getfit_minimum = '${deploymentTarget}'
    projects = installer.respond_to?(:generated_projects) ? installer.generated_projects : []
    projects = [installer.pods_project] if projects.empty?
    projects.compact.each do |project|
      project.targets.each do |target|
        target.build_configurations.each do |config|
          current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
          if current.nil? || Gem::Version.new(current.to_s) < Gem::Version.new(getfit_minimum)
            config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = getfit_minimum
          end
        end
      end
      project.save
    end
${END}
`;
}

/**
 * Returns `podfile` with the block inside its post_install, replacing any
 * copy an earlier prebuild left.
 *
 * @param {string} podfile contents of a generated Podfile
 * @param {string} deploymentTarget e.g. "15.1"
 * @returns {string}
 */
function withDeploymentTargetHook(podfile, deploymentTarget) {
  const cleaned = podfile.replace(EXISTING, '');
  const match = POST_INSTALL.exec(cleaned);

  if (!match) {
    throw new Error(
      'This Podfile has no post_install block to extend. Expo generates one; ' +
        'if that changed, this plugin needs updating rather than skipping.',
    );
  }

  // The block's own `end` is the first one back at its indentation. Matching
  // the nearest `end` instead lands inside whichever loop Expo has nested in
  // there — currently the resource-bundle code-signing one — which is valid
  // Ruby that runs the wrong number of times in the wrong scope.
  const indent = match[1];
  const lines = cleaned.split('\n');
  const opensAt = cleaned.slice(0, match.index).split('\n').length - 1;
  const closesAt = lines.findIndex(
    (line, index) => index > opensAt && new RegExp(`^${indent}end[ \t]*$`).test(line),
  );

  if (closesAt === -1) {
    throw new Error("The Podfile's post_install block is never closed at its own indentation.");
  }

  lines.splice(closesAt, 0, block(deploymentTarget).replace(/\n$/, ''));
  return lines.join('\n');
}

/** The deployment target expo-build-properties was configured with. */
function configuredTarget(config) {
  for (const plugin of config.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === 'expo-build-properties') {
      const target = plugin[1]?.ios?.deploymentTarget;
      if (target) return String(target);
    }
  }
  return null;
}

/** @type {import('@expo/config-plugins').ConfigPlugin} */
const withPodDeploymentTarget = (config) =>
  withDangerousMod(config, [
    'ios',
    (dangerous) => {
      const deploymentTarget = configuredTarget(dangerous);
      if (!deploymentTarget) {
        throw new Error(
          'withPodDeploymentTarget needs ios.deploymentTarget from expo-build-properties. ' +
            'Set it there so the app target and the pods cannot disagree.',
        );
      }

      const podfile = path.join(dangerous.modRequest.platformProjectRoot, 'Podfile');
      const updated = withDeploymentTargetHook(fs.readFileSync(podfile, 'utf8'), deploymentTarget);
      fs.writeFileSync(podfile, updated);
      console.log(`  › Pods: every target raised to iOS ${deploymentTarget}`);

      return dangerous;
    },
  ]);

module.exports = withPodDeploymentTarget;
module.exports.withDeploymentTargetHook = withDeploymentTargetHook;
module.exports.configuredTarget = configuredTarget;
