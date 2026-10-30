import ActivityKit
import Foundation

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ ONE FILE, TWO MODULES.                                                    ║
// ║ The widget extension compiles this file, and so does the app through the  ║
// ║ local Expo module: modules/live-activity/ios/CravingActivity.swift is a   ║
// ║ symlink to it. ActivityKit pairs an activity with its UI by the           ║
// ║ attributes' type name and Codable shape, so the two copies must never     ║
// ║ drift: edit this file only, and never replace the symlink with a copy.    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/// « Surfer l'envie »: a ten-minute countdown started when a craving is logged.
/// An urge usually rises, peaks and fades; the activity keeps the person company
/// while it passes.
struct CravingActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /// nil while the wave is being surfed; "resisted" or "gave_in" once settled.
    var outcome: String?
  }

  /// Every word comes from the app's i18n (craving.activity.*), in the person's language.
  struct Copy: Codable, Hashable {
    var title: String
    var line: String
    var staleTitle: String
    var staleLine: String
    var resisted: String
    var gaveIn: String
    var resistedDone: String
    var gaveInDone: String
  }

  var cravingId: String
  var startedAt: Date
  var endsAt: Date
  var copy: Copy
}

/// Starts and ends the craving activities. The app reaches it through the Expo
/// module, the Live Activity buttons through CravingIntents.swift.
public enum CravingActivities {
  static var enabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

  /// One wave at a time: a new craving replaces the previous activity.
  static func start(_ attributes: CravingActivityAttributes) async throws -> String? {
    guard enabled else { return nil }
    for activity in Activity<CravingActivityAttributes>.activities {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
    // Once stale, the activity turns into « C'est passé ? » on its own.
    let content = ActivityContent(state: CravingActivityAttributes.ContentState(), staleDate: attributes.endsAt, relevanceScore: 1)
    return try Activity.request(attributes: attributes, content: content, pushType: nil).id
  }

  /// With an outcome, the activity says so for a few seconds before leaving.
  public static func end(cravingId: String, outcome: String?) async {
    for activity in Activity<CravingActivityAttributes>.activities where activity.attributes.cravingId == cravingId {
      if let outcome {
        let final = ActivityContent(state: CravingActivityAttributes.ContentState(outcome: outcome), staleDate: nil)
        await activity.end(final, dismissalPolicy: .after(.now.addingTimeInterval(4)))
      } else {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }

  /// iOS cannot end an activity on a timer while the app sleeps, so the app
  /// clears the ones whose « C'est passé ? » has waited long enough.
  static func endStale(grace: TimeInterval) async {
    for activity in Activity<CravingActivityAttributes>.activities where activity.attributes.endsAt.addingTimeInterval(grace) < .now {
      await activity.end(nil, dismissalPolicy: .immediate)
    }
  }
}
