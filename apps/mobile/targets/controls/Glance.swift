import Foundation
import SwiftUI
import UIKit

// The widgets are thin renderers of the server's Glance (packages/shared/src/glance.ts):
// the app shares the last one through the App Group, the extension refreshes it on its own.

struct GlanceMetric: Codable, Hashable {
  var nutrient: String
  var unit: String
  var consumed: Double
  var target: Double
  /// "target", "min" or "max".
  var kind: String
  /// target − consumed; negative once a max is passed.
  var remaining: Double
  /// "under", "on_track", "reached" or "over".
  var status: String

  var ratio: Double { target > 0 ? consumed / target : 0 }
  /// Past a ceiling (or a target): the app shows it in warning orange.
  var isOver: Bool { kind != "min" && (status == "over" || consumed > target) }
  /// A floor reached: the app shows a check.
  var reachedMin: Bool { kind == "min" && remaining <= 0 }

  /// The same metric with nothing eaten yet: what a new day looks like.
  var freshDay: GlanceMetric {
    GlanceMetric(nutrient: nutrient, unit: unit, consumed: 0, target: target, kind: kind, remaining: target, status: "under")
  }
}

struct Glance: Codable, Hashable {
  /// The local day it describes, "YYYY-MM-DD".
  var date: String
  var hero: GlanceMetric
  /// The hero first, then up to two more focus nutrients.
  var metrics: [GlanceMetric]
  var meals: Int

  /// The metrics shown next to the hero.
  var extras: [GlanceMetric] { Array(metrics.filter { $0.nutrient != hero.nutrient }.prefix(2)) }

  var freshDay: Glance {
    Glance(date: date, hero: hero.freshDay, metrics: metrics.map(\.freshDay), meals: 0)
  }

  static let sample = Glance(
    date: LocalDay.string(for: .now),
    hero: GlanceMetric(nutrient: "kcal", unit: "kcal", consumed: 1240, target: 2000, kind: "target", remaining: 760, status: "on_track"),
    metrics: [
      GlanceMetric(nutrient: "kcal", unit: "kcal", consumed: 1240, target: 2000, kind: "target", remaining: 760, status: "on_track"),
      GlanceMetric(nutrient: "protein", unit: "g", consumed: 54, target: 90, kind: "min", remaining: 36, status: "under"),
      GlanceMetric(nutrient: "fiber", unit: "g", consumed: 31, target: 30, kind: "min", remaining: -1, status: "reached"),
    ],
    meals: 2
  )
}

enum LocalDay {
  /// "YYYY-MM-DD" in the device's time zone, like toLocalDate() in the app.
  static func string(for date: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  static func nextMidnight(after date: Date) -> Date {
    Calendar.current.nextDate(after: date, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) ?? date.addingTimeInterval(86_400)
  }
}

// MARK: - Loading

enum TodayState: Hashable {
  /// Nobody is signed in (or the session was revoked).
  case signedOut
  /// Signed in, but the app has not shared a glance yet.
  case waiting
  /// `fresh` when the stored glance is from another day: a new day starts at zero.
  case day(Glance, fresh: Bool)
}

enum GlanceLoader {
  /// Older than this, the widget asks the server itself before rendering.
  static let maxAge: TimeInterval = 25 * 60

  static func load(now: Date = .now, network: Bool = true) async -> TodayState {
    guard SymbioseGroup.session != nil, let defaults = SymbioseGroup.defaults else { return .signedOut }
    let today = LocalDay.string(for: now)
    let stored = defaults.string(forKey: SymbioseGroup.Key.glance).flatMap(decode)
    let syncedAt = Date(timeIntervalSince1970: defaults.double(forKey: SymbioseGroup.Key.syncedAt) / 1000)

    if let stored, stored.date == today, now.timeIntervalSince(syncedAt) < maxAge {
      return .day(stored, fresh: false)
    }
    if network {
      switch await fetch(date: today, hideCalories: defaults.integer(forKey: SymbioseGroup.Key.hideCalories) == 1) {
      case .glance(let glance): return .day(glance, fresh: false)
      case .unauthorized: return .signedOut
      case .failed: break
      }
    }
    guard let stored else { return .waiting }
    // Offline after midnight: yesterday's numbers would be wrong, a fresh day is not.
    return .day(stored, fresh: stored.date != today)
  }

  private enum Fetch { case glance(Glance), unauthorized, failed }

  private static func fetch(date: String, hideCalories: Bool) async -> Fetch {
    guard let request = SymbioseGroup.request("GET", "/api/glance?date=\(date)&hideCalories=\(hideCalories ? 1 : 0)", timeout: 8),
          let (data, response) = try? await URLSession.shared.data(for: request),
          let http = response as? HTTPURLResponse
    else { return .failed }
    if http.statusCode == 401 { return .unauthorized }
    guard http.statusCode == 200, let json = String(data: data, encoding: .utf8), let glance = decode(json) else { return .failed }
    // Keep it for the next reload, exactly as the app would have written it.
    let defaults = SymbioseGroup.defaults
    defaults?.set(json, forKey: SymbioseGroup.Key.glance)
    defaults?.set(Date.now.timeIntervalSince1970 * 1000, forKey: SymbioseGroup.Key.syncedAt)
    return .glance(glance)
  }

  private static func decode(_ json: String) -> Glance? {
    json.data(using: .utf8).flatMap { try? JSONDecoder().decode(Glance.self, from: $0) }
  }
}

// MARK: - Words and numbers

/// The few words the widgets need, in the language chosen in the app.
struct L10n: Hashable {
  let fr: Bool

  static var current: L10n {
    if let locale = SymbioseGroup.defaults?.string(forKey: SymbioseGroup.Key.locale) { return L10n(fr: locale == "fr") }
    return device
  }

  static var device: L10n { L10n(fr: Locale.preferredLanguages.first?.hasPrefix("fr") ?? false) }

  var widgetName: String { fr ? "Ma journée" : "My day" }
  var widgetDescription: String { fr ? "Ce qu’il te reste aujourd’hui, d’un coup d’œil." : "What’s left today, at a glance." }
  var capture: String { fr ? "Photographier" : "Snap a meal" }
  var signedOutTitle: String { "Symbiose" }
  var signedOutBody: String { fr ? "Connecte-toi pour retrouver ta journée." : "Sign in to see your day here." }
  var waitingBody: String { fr ? "Ouvre l’app pour retrouver ta journée." : "Open the app to see your day here." }
  var signIn: String { fr ? "Se connecter" : "Sign in" }
  var noMeal: String { fr ? "Rien de noté pour l’instant" : "Nothing logged yet" }

  func meals(_ count: Int) -> String {
    if fr { return count <= 1 ? "\(count) repas noté" : "\(count) repas notés" }
    return count == 1 ? "1 meal logged" : "\(count) meals logged"
  }

  /// The word above the number in the ring.
  func status(_ metric: GlanceMetric) -> String {
    if metric.reachedMin { return fr ? "atteint" : "reached" }
    if metric.isOver { return fr ? "au-dessus" : "over" }
    if metric.kind == "min" { return fr ? "encore" : "to go" }
    return fr ? "reste" : "left"
  }

  /// One line for the Lock Screen: "Reste 760 kcal", "Encore 36 g", "Protéines atteintes".
  func sentence(_ metric: GlanceMetric) -> String {
    let amount = Nutrient.amount(metric, value: abs(metric.remaining), locale: self)
    if metric.reachedMin { return fr ? "Objectif atteint" : "Goal reached" }
    if metric.isOver { return fr ? "\(amount) au-dessus" : "\(amount) over" }
    if metric.kind == "min" { return fr ? "Encore \(amount)" : "\(amount) to go" }
    return fr ? "Reste \(amount)" : "\(amount) left"
  }
}

enum Nutrient {
  private static let names: [String: (fr: String, en: String)] = [
    "kcal": ("Calories", "Calories"),
    "protein": ("Protéines", "Protein"),
    "carbs": ("Glucides", "Carbs"),
    "sugar": ("Sucres", "Sugars"),
    "addedSugar": ("Sucres ajoutés", "Added sugars"),
    "fat": ("Lipides", "Fat"),
    "satFat": ("Graisses saturées", "Saturated fat"),
    "fiber": ("Fibres", "Fiber"),
    "sodium": ("Sodium", "Sodium"),
  ]

  /// NUTRIENT_COLORS in src/theme; calories take the accent.
  private static let colors: [String: Color] = [
    "protein": Color(hex: 0xFF7A59),
    "carbs": Color(hex: 0xF2B23A),
    "fat": Color(hex: 0x4F8EF7),
    "sugar": Color(hex: 0xEC5FA0),
    "addedSugar": Color(hex: 0xD23C86),
    "satFat": Color(hex: 0x7C9FD8),
    "fiber": Color(hex: 0x3FB27F),
    "sodium": Color(hex: 0x9B7CF4),
  ]

  static func name(_ key: String, _ l: L10n) -> String {
    guard let name = names[key] else { return key }
    return l.fr ? name.fr : name.en
  }

  static func color(_ key: String) -> Color { colors[key] ?? Palette.accent }

  /// "1 240", "4,5", like formatAmount() in the app: whole kcal and mg, one decimal under 10 g.
  static func number(_ key: String, _ value: Double, locale: L10n) -> String {
    let whole = key == "kcal" || key == "sodium" || value >= 10
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: locale.fr ? "fr_FR" : "en_US")
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = whole ? 0 : 1
    let text = formatter.string(from: NSNumber(value: value)) ?? "\(Int(value))"
    // A plain no-break space keeps "1 240" together and renders in every font.
    return text.replacingOccurrences(of: "\u{202F}", with: "\u{00A0}")
  }

  static func amount(_ metric: GlanceMetric, value: Double, locale: L10n) -> String {
    "\(number(metric.nutrient, value, locale: locale))\u{00A0}\(metric.unit)"
  }
}

/// src/theme in Swift, in sRGB like the app (asset catalog colours would be read as Display P3).
enum Palette {
  static let accent = Color(light: 0x00803F, dark: 0x2EE68A)
  static let accentSoft = Color(light: 0xE2F9EA, dark: 0x0D3320)
  /// Text and icons on the accent.
  static let onAccent = Color(light: 0xFFFFFF, dark: 0x0A0A0B)
  static let surface = Color(light: 0xFFFFFF, dark: 0x161618)
  static let track = Color(light: 0xEDECE7, dark: 0x2A2A2E)
  static let warning = Color(light: 0xE8890C, dark: 0xFFB224)

  /// The logo's fill, emerald in the cell to acid lime in the bud, for a square `LogoMark`.
  static let bourgeon = LinearGradient(
    stops: [
      .init(color: Color(light: 0x00934A, dark: 0x00B85C), location: 0),
      .init(color: Color(light: 0x0DC466, dark: 0x1FE584), location: 0.48),
      .init(color: Color(light: 0x5BE65E, dark: 0x8DFF62), location: 0.76),
      .init(color: Color(light: 0xC2FF2E, dark: 0xE2FF4D), location: 1),
    ],
    startPoint: UnitPoint(x: 0.153, y: 0.934),
    endPoint: UnitPoint(x: 0.898, y: 0.073)
  )
}

extension Color {
  init(hex: UInt32) {
    self.init(uiColor: UIColor(hex: hex))
  }

  init(light: UInt32, dark: UInt32) {
    self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
  }
}

extension UIColor {
  convenience init(hex: UInt32) {
    self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
  }
}
