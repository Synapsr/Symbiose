import Foundation

// The `Glance` contract from packages/shared/src/glance.ts, decoded as-is.
// Unknown keys are ignored, so the server can grow it without breaking the watch.

struct Glance: Codable, Equatable {
  var date: String
  var hero: GlanceMetric
  /// The hero first, then the plan's other focus nutrients (three at most).
  var metrics: [GlanceMetric]
  var meals: Int
  var lastMealAt: String?
  var relog: [GlanceRelog]

  /// The metrics shown next to the hero ring.
  var others: [GlanceMetric] { Array(metrics.filter { $0.nutrient != hero.nutrient }.prefix(2)) }

  /// The same targets on a fresh day: what the watch shows after midnight until it reaches the server.
  func freshDay(_ day: String) -> Glance {
    var copy = self
    copy.date = day
    copy.metrics = metrics.map { $0.reset() }
    copy.hero = hero.reset()
    copy.meals = 0
    copy.lastMealAt = nil
    return copy
  }
}

struct GlanceMetric: Codable, Equatable, Identifiable {
  var nutrient: String
  var unit: String
  var consumed: Double
  var target: Double
  /// target | min | max
  var kind: String
  /// target − consumed; negative once a max is passed.
  var remaining: Double
  /// under | on_track | reached | over
  var status: String

  var id: String { nutrient }
  var progress: Double { target > 0 ? consumed / target : 0 }

  enum Tone { case normal, over, done }

  /// Mirrors the Today hero: amber once a max (or the energy target) is passed, a check once a min is reached.
  var tone: Tone {
    if kind == "min" { return remaining <= 0 ? .done : .normal }
    return status == "over" || consumed > target ? .over : .normal
  }

  func reset() -> GlanceMetric {
    var copy = self
    copy.consumed = 0
    copy.remaining = target
    copy.status = kind == "max" ? "on_track" : "under"
    return copy
  }
}

/// A meal to log again in one tap.
struct GlanceRelog: Codable, Equatable, Identifiable {
  var mealId: String
  var title: String
  var emoji: String
  var mealType: String
  var kcal: Double
  /// Amount of the hero nutrient, in its unit.
  var hero: Double

  var id: String { mealId }
}

extension GlanceMetric {
  static func sample(_ nutrient: String, unit: String, consumed: Double, target: Double, kind: String) -> GlanceMetric {
    let ratio = target > 0 ? consumed / target : 0
    let status = switch kind {
    case "max": ratio > 1 ? "over" : ratio >= 0.85 ? "reached" : "on_track"
    case "min": ratio >= 1 ? "reached" : "under"
    default: ratio > 1.1 ? "over" : ratio >= 0.9 ? "reached" : "under"
    }
    return GlanceMetric(nutrient: nutrient, unit: unit, consumed: consumed, target: target, kind: kind, remaining: target - consumed, status: status)
  }
}

extension Glance {
  /// A typical afternoon, for the face gallery before any data.
  static var placeholder: Glance {
    let metrics = [
      GlanceMetric.sample("kcal", unit: "kcal", consumed: 760, target: 2000, kind: "target"),
      GlanceMetric.sample("protein", unit: "g", consumed: 62, target: 90, kind: "min"),
      GlanceMetric.sample("fiber", unit: "g", consumed: 18, target: 30, kind: "min"),
    ]
    return Glance(date: LocalDay.string(), hero: metrics[0], metrics: metrics, meals: 2, lastMealAt: nil, relog: [])
  }
}
