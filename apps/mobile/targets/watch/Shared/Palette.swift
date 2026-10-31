import SwiftUI

/// The app's dark palette (src/theme): the watch is always dark.
enum Palette {
  static let accent = Color(hex: 0x5FD6B4)
  static let accentSoft = Color(hex: 0x122C27)
  static let warning = Color(hex: 0xFFB224)
  static let surface = Color(hex: 0x161618)
  static let surface2 = Color(hex: 0x222225)
  static let text2 = Color(hex: 0x9A9AA0)
  static let text3 = Color(hex: 0x5F5F66)

  /// The logo's body: silver ink (the watch is always dark), for a square `LogoMark`.
  static let markInk = LinearGradient(
    colors: [Color(hex: 0xB9BEC4), Color(hex: 0xF5F5F3)],
    startPoint: UnitPoint(x: 0.153, y: 0.934),
    endPoint: UnitPoint(x: 0.898, y: 0.073)
  )

  /// The bud's light, the mark's only colour. `radius` in points: 22.3 × size / 68.5.
  static func budLight(radius: CGFloat) -> RadialGradient {
    RadialGradient(
      stops: [
        .init(color: Color(hex: 0xF0FFF7), location: 0),
        .init(color: Color(hex: 0x6FF2BE), location: 0.55),
        .init(color: Color(hex: 0x1DBF8A), location: 1),
      ],
      center: UnitPoint(x: 0.38, y: 0.34), startRadius: 0, endRadius: radius
    )
  }

  /// One colour per nutrient, as in rings, bars and chips on the phone.
  static func nutrient(_ key: String) -> Color {
    switch key {
    case "protein": Color(hex: 0xFF7A59)
    case "carbs": Color(hex: 0xF2B23A)
    case "fat": Color(hex: 0x4F8EF7)
    case "sugar": Color(hex: 0xEC5FA0)
    case "addedSugar": Color(hex: 0xD23C86)
    case "satFat": Color(hex: 0x7C9FD8)
    case "fiber": Color(hex: 0x3FB27F)
    case "sodium": Color(hex: 0x9B7CF4)
    default: accent
    }
  }

  /// The hero follows its status: accent, amber once a max is passed.
  static func hero(_ metric: GlanceMetric) -> Color { metric.tone == .over ? warning : accent }

  /// The other metrics keep their nutrient colour until they go over.
  static func metric(_ metric: GlanceMetric) -> Color { metric.tone == .over ? warning : nutrient(metric.nutrient) }
}

extension Color {
  init(hex: UInt32) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }
}

extension Font {
  /// SF Rounded, the app's face for numbers.
  static func rounded(_ size: CGFloat, _ weight: Font.Weight = .semibold) -> Font {
    .system(size: size, weight: weight, design: .rounded)
  }
}
