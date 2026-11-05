import Foundation
import Observation
import WatchKit

/// The watch's state: credentials from the phone, the glance, and the actions.
/// Every change to the day refreshes the glance and the complications.
@MainActor
@Observable
final class WatchModel {
  static let shared = WatchModel()

  private(set) var credentials: Credentials?
  private(set) var glance: Glance?
  private(set) var lang: Lang = .device
  private(set) var hideCalories = false
  private(set) var updatedAt: Date?
  private(set) var refreshing = false
  /// Why the last refresh failed, already in the person's language.
  private(set) var problem: String?

  var copy: Copy { Copy(lang: lang) }
  var signedIn: Bool { credentials != nil }
  /// Symbiose runs on the iPhone, without a server: the watch goes through it.
  var onPhone: Bool { credentials.map { PhoneLink.isLocal($0.serverUrl) } ?? false }

  private init() { reload() }

  /// Re-reads what the phone or a background refresh stored.
  func reload() {
    credentials = Credentials.load()
    let cache = GlanceCache.load()
    glance = cache.glance(at: Date())
    lang = cache.lang
    hideCalories = cache.hideCalories
    updatedAt = cache.savedAt
    if credentials == nil { problem = nil }
  }

  /// Fetches today's glance, stores it for the complications and reloads them.
  @discardableResult
  func refresh() async -> Bool {
    guard let api, !refreshing else { return false }
    refreshing = true
    defer { refreshing = false }
    do {
      let fresh = try await api.glance(hideCalories: hideCalories)
      glance = fresh
      updatedAt = Date()
      problem = nil
      GlanceCache.save(fresh)
      GlanceCache.reloadComplications()
      return true
    } catch API.Failure.unauthorized {
      signOut()
      return false
    } catch API.Failure.offline where onPhone {
      // The iPhone out of reach: its last glance stays, and comes again when it is.
      problem = nil
      return false
    } catch {
      problem = message(for: error)
      return false
    }
  }

  // MARK: Actions

  func relog(_ meal: GlanceRelog) async throws -> LoggedMeal {
    try await act { try await $0.duplicate(mealId: meal.mealId) }
  }

  func logMeal(text: String) async throws -> LoggedMeal {
    try await act { try await $0.logMeal(text: text) }
  }

  func undo(_ meal: LoggedMeal) async throws {
    try await act { try await $0.deleteMeal(id: meal.id) }
  }

  func craving(_ what: String) async throws -> CravingHelp {
    try await act { try await $0.craving(what: what) }
  }

  func settleCraving(_ help: CravingHelp, resisted: Bool) async throws {
    try await act { try await $0.settleCraving(id: help.craving.id, resisted: resisted) }
  }

  /// The words to show for a failed action.
  func message(for error: Error) -> String {
    switch error as? API.Failure {
    case .offline: onPhone ? copy.phoneAway : copy.offline
    case .queued: copy.queued
    case let .server(message): message.isEmpty ? copy.failed : message
    default: copy.failed
    }
  }

  // MARK: Helpers

  private var api: API? { credentials.map(API.init(credentials:)) }

  /// Runs a call, then refreshes the glance and the complications. A revoked token signs the watch out.
  private func act<T>(_ call: (API) async throws -> T) async throws -> T {
    guard let api else { throw API.Failure.unauthorized }
    do {
      let result = try await call(api)
      Task { await refresh() }
      return result
    } catch API.Failure.unauthorized {
      signOut()
      throw API.Failure.unauthorized
    }
  }

  private func signOut() {
    Credentials.clear()
    GlanceCache.clear()
    GlanceCache.reloadComplications()
    reload()
  }
}

enum Haptic {
  static func success() { WKInterfaceDevice.current().play(.success) }
  static func failure() { WKInterfaceDevice.current().play(.failure) }
  static func tap() { WKInterfaceDevice.current().play(.click) }
}

/// Wakes the app every ~45 minutes to keep the glance and the complications current.
enum BackgroundRefresh {
  static func schedule() {
    WKApplication.shared().scheduleBackgroundRefresh(withPreferredDate: Date(timeIntervalSinceNow: 45 * 60), userInfo: nil) { _ in }
  }
}
