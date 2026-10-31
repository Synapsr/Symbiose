/**
 * Signs Android release builds with the Play upload key, read from Gradle
 * properties that never live in the repo: ~/.gradle/gradle.properties, or
 * ORG_GRADLE_PROJECT_<NAME> environment variables (see docs/android-release.md).
 *
 *   SYMBIOSE_UPLOAD_STORE_FILE      absolute path to the upload keystore
 *   SYMBIOSE_UPLOAD_STORE_PASSWORD
 *   SYMBIOSE_UPLOAD_KEY_ALIAS
 *   SYMBIOSE_UPLOAD_KEY_PASSWORD
 *
 * Without them, a release build is signed with the debug key, as Expo's
 * template does: fine on a device or an emulator, refused by Google Play.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = 'SYMBIOSE_UPLOAD_STORE_FILE';

const RELEASE_SIGNING = `
        release {
            // The Play upload key, never in git: see docs/android-release.md.
            if (findProperty('${MARK}')) {
                storeFile file(findProperty('${MARK}'))
                storePassword findProperty('SYMBIOSE_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('SYMBIOSE_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('SYMBIOSE_UPLOAD_KEY_PASSWORD')
            }
        }`;

function addReleaseSigning(gradle) {
  if (gradle.includes(MARK)) return gradle;
  const configs = gradle.indexOf('signingConfigs {');
  const buildTypes = gradle.indexOf('buildTypes {');
  const release = buildTypes < 0 ? -1 : gradle.indexOf('release {', buildTypes);
  const debugSigning = 'signingConfig signingConfigs.debug';
  const releaseSigning = release < 0 ? -1 : gradle.indexOf(debugSigning, release);
  if (configs < 0 || releaseSigning < 0) {
    throw new Error('[with-android-signing] android/app/build.gradle no longer has the expected signingConfigs and release blocks');
  }
  const withSigning =
    gradle.slice(0, releaseSigning) + `signingConfig findProperty('${MARK}') ? signingConfigs.release : signingConfigs.debug` + gradle.slice(releaseSigning + debugSigning.length);
  const at = configs + 'signingConfigs {'.length;
  return withSigning.slice(0, at) + RELEASE_SIGNING + withSigning.slice(at);
}

module.exports = function withAndroidSigning(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = addReleaseSigning(config.modResults.contents);
    return config;
  });
};
