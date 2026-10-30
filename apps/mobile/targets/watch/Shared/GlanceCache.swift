import Foundation
import WidgetKit

/// The latest glance and display settings, in the watch's App Group so the
/// complications can render them. Credentials never go here (see Credentials).
enum GlanceCache {
  static let appGroup = "group.io.synapsr.symbiose"
  static let complicationKind = "io.synapsr.symbiose.watch.hero"

  private enum Key {
    static let glance = "watch.glance"
    static let savedAt = "watch.glanceSavedAt"
    static let lang = "watch.locale"
    static let hideCalories = "watch.hideCalories"
  }

  private static var defaults: UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

  struct Snapshot {
    var glance: Glance?
    var savedAt: Date?
    var lang: Lang
    var hideCalories: Bool

    /// The glance for `date`: a stored one from an earlier day starts over with the same targets.
    func glance(at date: Date) -> Glance? {
      guard let glance else { return nil }
      let today = LocalDay.string(date)
      return glance.date < today ? glance.freshDay(today) : glance
    }
  }

  static func load() -> Snapshot {
    let defaults = defaults
    let glance = defaults.data(forKey: Key.glance).flatMap { try? JSONDecoder().decode(Glance.self, from: $0) }
    return Snapshot(
      glance: glance,
      savedAt: defaults.object(forKey: Key.savedAt) as? Date,
      lang: defaults.string(forKey: Key.lang).flatMap(Lang.init(rawValue:)) ?? .device,
      hideCalories: defaults.bool(forKey: Key.hideCalories)
    )
  }

  static func save(_ glance: Glance) {
    guard let data = try? JSONEncoder().encode(glance) else { return }
    defaults.set(data, forKey: Key.glance)
    defaults.set(Date(), forKey: Key.savedAt)
  }

  static func save(lang: Lang, hideCalories: Bool) {
    defaults.set(lang.rawValue, forKey: Key.lang)
    defaults.set(hideCalories, forKey: Key.hideCalories)
  }

  static func clear() {
    for key in [Key.glance, Key.savedAt, Key.hideCalories] { defaults.removeObject(forKey: key) }
  }

  static func reloadComplications() {
    WidgetCenter.shared.reloadTimelines(ofKind: complicationKind)
  }
}

/// Local calendar days, as `YYYY-MM-DD` like the server's `localDate`.
enum LocalDay {
  static func string(_ date: Date = Date()) -> String {
    let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  static func nextMidnight(after date: Date) -> Date {
    Calendar.current.nextDate(after: date, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) ?? date.addingTimeInterval(86_400)
  }
}
