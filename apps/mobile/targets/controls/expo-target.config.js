/**
 * The Symbiose widget extension: Home and Lock Screen widgets, the craving
 * Live Activity, and the Control Center / Action Button controls (iOS 18+).
 *
 * The folder and bundle id keep their original "controls" name so the
 * extension already signed for TestFlight stays the same one.
 */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'SymbioseControls',
  displayName: 'Symbiose',
  bundleIdentifier: '.controls',
  deploymentTarget: '18.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents', 'ActivityKit'],
  entitlements: {
    // Shared with the app: the glance, the server URL and the session token.
    'com.apple.security.application-groups': config.ios?.entitlements?.['com.apple.security.application-groups'] ?? ['group.io.synapsr.symbiose'],
  },
  // The global tint (buttons when editing a widget). The views' palette lives in
  // Glance.swift, in sRGB like the app. Note: the plugin reads `light`/`dark`,
  // not the `color`/`darkColor` its README shows (that left $accent empty).
  colors: {
    $accent: { light: '#00803F', dark: '#2EE68A' },
  },
});
