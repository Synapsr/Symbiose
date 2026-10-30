import AppIntents
import SwiftUI
import WidgetKit

// Controls appear in Control Center, on the Lock Screen and can be assigned
// to the Action Button. Each one deep-links into the app.

struct CaptureMealControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "io.synapsr.symbiose.control.capture") {
      ControlWidgetButton(action: CaptureMealIntent()) {
        Label("Photographier un repas", systemImage: "camera.fill")
      }
    }
    .displayName("Photographier un repas")
    .description("Ouvre directement l’appareil photo de Symbiose.")
  }
}

struct CravingControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "io.synapsr.symbiose.control.craving") {
      ControlWidgetButton(action: CravingIntent()) {
        Label("J’ai une envie", systemImage: "sparkles")
      }
    }
    .displayName("J’ai une envie")
    .description("Un conseil tout de suite pour traverser l’envie.")
  }
}

struct CaptureMealIntent: AppIntent {
  static let title: LocalizedStringResource = "Photographier un repas"
  static let description = IntentDescription("Ouvre l’appareil photo de Symbiose.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "symbiose://capture")!))
  }
}

struct CravingIntent: AppIntent {
  static let title: LocalizedStringResource = "J’ai une envie"
  static let description = IntentDescription("Ouvre l’aide aux envies de Symbiose.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(URL(string: "symbiose://craving")!))
  }
}
