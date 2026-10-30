/** Control Center / Action Button / Lock Screen controls (iOS 18+). */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'SymbioseControls',
  displayName: 'Symbiose',
  bundleIdentifier: '.controls',
  deploymentTarget: '18.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'AppIntents'],
  colors: {
    $accent: { color: '#1F8A5B', darkColor: '#3DD68C' },
  },
};
