Pod::Spec.new do |s|
  s.name           = 'LoopbackAuth'
  s.version        = '1.0.0'
  s.summary        = 'A one-shot 127.0.0.1 web server for OAuth sign-ins that redirect to a loopback address.'
  s.description    = 'Listens on the loopback interface with Network.framework until the browser comes back with the code.'
  s.author         = 'Symbiose'
  s.homepage       = 'https://symbiose.synapsr.io'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
