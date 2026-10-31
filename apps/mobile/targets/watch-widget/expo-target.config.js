/**
 * Watch face complications (WidgetKit): what's left today of the hero metric.
 * Embedded in the watch app, so its bundle id extends the watch app's.
 * `Shared` is a symlink to ../watch/Shared: the model, formatting and the
 * complication views are compiled into both targets.
 */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch-widget',
  name: 'SymbioseComplications',
  displayName: 'Symbiose',
  bundleIdentifier: '.watchkitapp.complications',
  deploymentTarget: '10.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
  colors: {
    $accent: { light: '#2EE68A', dark: '#2EE68A' },
    $widgetBackground: { light: '#0A0A0B', dark: '#0A0A0B' },
  },
  entitlements: {
    'com.apple.security.application-groups': ['group.io.synapsr.symbiose'],
  },
};
