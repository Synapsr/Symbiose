import AppIntents
import Foundation

#if canImport(SymbioseLiveActivity)
// In the app, the activity controller comes from the local Expo module
// (modules/live-activity), the only ActivityKit user in the app's process.
// The extension compiles its own copy of the same file (CravingActivity.swift).
// `internal` like the import in the generated ExpoModulesProvider.swift.
internal import SymbioseLiveActivity
#endif

// The two buttons of the « surfer l'envie » Live Activity.
//
// A LiveActivityIntent runs perform() in the app's process (iOS launches it in
// the background if needed), so the intent types must exist in the app AND in
// the extension, which renders Button(intent:). That is why this file lives in
// `_shared`: @bacons/apple-targets compiles it into both targets.

@available(iOS 17.0, *)
struct ResistedCravingIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "J’ai tenu"
  static let isDiscoverable = false

  @Parameter(title: "Envie")
  var cravingId: String

  init() {}
  init(cravingId: String) { self.cravingId = cravingId }

  func perform() async throws -> some IntentResult {
    await CravingOutcome.settle(cravingId, as: "resisted")
    return .result()
  }
}

@available(iOS 17.0, *)
struct GaveInCravingIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "J’ai craqué"
  static let isDiscoverable = false

  @Parameter(title: "Envie")
  var cravingId: String

  init() {}
  init(cravingId: String) { self.cravingId = cravingId }

  func perform() async throws -> some IntentResult {
    await CravingOutcome.settle(cravingId, as: "gave_in")
    return .result()
  }
}

/// Records how a craving ended, straight from the Lock Screen or the Dynamic Island.
enum CravingOutcome {
  /// Shows the outcome on the activity while `PATCH /api/cravings/:id` goes out.
  /// Offline, the outcome waits in the App Group until the app is next opened.
  static func settle(_ cravingId: String, as outcome: String) async {
    async let sent = send(cravingId, outcome)
    await CravingActivities.end(cravingId: cravingId, outcome: outcome)
    if await !sent { queue(cravingId, outcome) }
    SymbioseGroup.defaults?.set(true, forKey: SymbioseGroup.Key.cravingsChanged)
  }

  private static func send(_ cravingId: String, _ outcome: String) async -> Bool {
    let id = cravingId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? cravingId
    guard let request = SymbioseGroup.request("PATCH", "/api/cravings/\(id)", body: ["outcome": outcome]) else { return false }
    guard let (_, response) = try? await URLSession.shared.data(for: request), let http = response as? HTTPURLResponse else { return false }
    // A 4xx will never succeed (the craving is gone, or the session is): nothing to retry.
    return http.statusCode < 500
  }

  private static func queue(_ cravingId: String, _ outcome: String) {
    guard let defaults = SymbioseGroup.defaults else { return }
    var pending: [String: String] = [:]
    if let json = defaults.string(forKey: SymbioseGroup.Key.pendingOutcomes)?.data(using: .utf8),
       let stored = try? JSONSerialization.jsonObject(with: json) as? [String: String] {
      pending = stored
    }
    pending[cravingId] = outcome
    if let data = try? JSONSerialization.data(withJSONObject: pending), let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: SymbioseGroup.Key.pendingOutcomes)
    }
  }
}
