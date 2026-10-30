/**
 * The Apple Watch app: the hero ring, « Remanger » and « Dicter un repas ».
 * watchOS 10 is the floor: it brings Observation, containerBackground and the
 * vertical page TabView, and still runs on every watch paired with iOS 17+.
 * The App Group is the watch's own container, shared with the complications.
 */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'SymbioseWatch',
  displayName: 'Symbiose',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  icon: '../../assets/images/icon-dark.png',
  frameworks: ['SwiftUI', 'WatchKit', 'WatchConnectivity', 'WidgetKit'],
  colors: {
    $accent: { light: '#3DD68C', dark: '#3DD68C' },
  },
  entitlements: {
    'com.apple.security.application-groups': ['group.io.synapsr.symbiose'],
  },
};
