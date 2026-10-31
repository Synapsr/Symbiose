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
  // Its own icon: the mark is centred for the watch's circle mask.
  icon: '../../assets/images/watch-icon.png',
  frameworks: ['SwiftUI', 'WatchKit', 'WatchConnectivity', 'WidgetKit'],
  colors: {
    $accent: { light: '#2EE68A', dark: '#2EE68A' },
  },
  entitlements: {
    'com.apple.security.application-groups': ['group.io.synapsr.symbiose'],
  },
};
