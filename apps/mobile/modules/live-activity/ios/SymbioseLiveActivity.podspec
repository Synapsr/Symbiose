Pod::Spec.new do |s|
  s.name           = 'SymbioseLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Starts and ends the Symbiose craving Live Activity.'
  s.description    = 'Starts and ends the « surfer l’envie » Live Activity from JavaScript.'
  s.author         = 'Symbiose'
  s.homepage       = 'https://github.com/synapsr/symbiose'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # CravingActivity.swift is a symlink to targets/controls/CravingActivity.swift:
  # the app and the widget extension compile the very same attributes type.
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
