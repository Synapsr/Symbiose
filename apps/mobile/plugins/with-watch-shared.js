/**
 * The watch app and its complications share code: the Glance model, number
 * formatting, copy and the complication views live in targets/watch/Shared.
 * @bacons/apple-targets links each target folder to one target only, so this
 * plugin also makes the complications compile the Shared Swift files (the same
 * membership trick the plugin uses for `_shared` and the iPhone app).
 *
 * It also checks that the complications are embedded in the watch app, not in
 * the iPhone app, since that depends on the order the targets are created in.
 *
 * Listed before "@bacons/apple-targets" in app.json so it runs after the
 * targets exist (Expo runs mods in reverse registration order).
 */
const fs = require('fs');
const path = require('path');
const { withMod } = require('expo/config-plugins');
const { PBXCopyFilesBuildPhase, PBXFileSystemSynchronizedBuildFileExceptionSet } = require('@bacons/xcode');

const WATCH = 'SymbioseWatch';
const COMPLICATIONS = 'SymbioseComplications';
const SHARED_DIR = 'Shared';

module.exports = function withWatchShared(config) {
  return withMod(config, {
    platform: 'ios',
    mod: 'xcodeProjectBeta2',
    action(config) {
      const project = config.modResults;
      const targets = project.rootObject.props.targets;
      const watch = targets.find((t) => t.props.name === WATCH);
      const complications = targets.find((t) => t.props.name === COMPLICATIONS);
      if (!watch || !complications) return config;

      // 1. Compile targets/watch/Shared/*.swift into the complications too.
      const group = (watch.props.fileSystemSynchronizedGroups ?? []).find((g) => g.props.path === 'watch');
      if (!group) throw new Error(`[with-watch-shared] ${WATCH} has no synchronized "watch" folder`);
      const sharedDir = path.join(config.modRequest.projectRoot, 'targets', 'watch', SHARED_DIR);
      const files = fs
        .readdirSync(sharedDir)
        .filter((file) => file.endsWith('.swift'))
        .map((file) => `${SHARED_DIR}/${file}`)
        .sort();
      group.props.exceptions ??= [];
      const existing = group.props.exceptions.find((e) => e.props.target === complications);
      if (existing) existing.props.membershipExceptions = files;
      else
        group.props.exceptions.push(
          PBXFileSystemSynchronizedBuildFileExceptionSet.create(project, { target: complications, membershipExceptions: files }),
        );

      // 2. The complications belong inside the watch app.
      const product = complications.props.productReference;
      const embeddedInWatch = watch.props.buildPhases.some(
        (phase) => PBXCopyFilesBuildPhase.is(phase) && phase.props.files.some((file) => file.props.fileRef === product),
      );
      if (!embeddedInWatch) {
        throw new Error(
          `[with-watch-shared] ${COMPLICATIONS}.appex is not embedded in ${WATCH}.app. ` +
            'Run `npx expo prebuild --platform ios --clean` again; if it persists, the target creation order changed.',
        );
      }
      return config;
    },
  });
};
