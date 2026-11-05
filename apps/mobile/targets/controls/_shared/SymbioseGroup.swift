import Foundation

/// The App Group the app and the widget extension share. The app writes these
/// keys in src/lib/widgets.ios.ts (and reads the pending outcomes back in
/// src/lib/live-activity.ios.ts): keep the names in sync.
///
/// Compiled into both the app and the extension (this is the `_shared` folder).
enum SymbioseGroup {
  static let id = "group.io.synapsr.symbiose"

  enum Key {
    /// The last `GET /api/glance` response, as JSON.
    static let glance = "widget.glance"
    /// When `glance` was written, in milliseconds since 1970.
    static let syncedAt = "widget.syncedAt"
    static let serverUrl = "widget.serverUrl"
    static let token = "widget.token"
    /// "fr" or "en", the language the person chose in the app.
    static let locale = "widget.locale"
    /// 1 when the person hides calories.
    static let hideCalories = "widget.hideCalories"
    /// Craving outcomes the Live Activity could not send yet, as `{ id: outcome }` JSON.
    static let pendingOutcomes = "craving.pendingOutcomes"
    /// Set when the Live Activity settled a craving: the app refreshes the day.
    static let cravingsChanged = "craving.changed"
  }

  static var defaults: UserDefaults? { UserDefaults(suiteName: id) }

  /// The server and token, when someone is signed in.
  static var session: (server: String, token: String)? {
    guard let defaults,
          let server = defaults.string(forKey: Key.serverUrl), !server.isEmpty,
          let token = defaults.string(forKey: Key.token), !token.isEmpty
    else { return nil }
    return (server.hasSuffix("/") ? String(server.dropLast()) : server, token)
  }

  /// An authenticated JSON request to the person's own server. None when the data
  /// lives on the phone (`local://phone`, no server): the widget shows what the app
  /// last shared, and a craving's outcome waits for the app (`pendingOutcomes`).
  static func request(_ method: String, _ path: String, body: [String: Any]? = nil, timeout: TimeInterval = 10) -> URLRequest? {
    guard let session, session.server.hasPrefix("http"), let url = URL(string: session.server + path) else { return nil }
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "accept")
    request.setValue("Bearer \(session.token)", forHTTPHeaderField: "authorization")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }
    return request
  }
}
