import Foundation

/// The few Symbiose endpoints the watch calls, straight to the server.
struct API {
  enum Failure: Error, Equatable {
    case offline
    case unauthorized
    case server(String)
  }

  let credentials: Credentials

  func glance(hideCalories: Bool) async throws -> Glance {
    try await send("GET", "/api/glance?date=\(LocalDay.string())&hideCalories=\(hideCalories ? 1 : 0)", timeout: 15)
  }

  /// "Same as last time": copies a meal to now.
  func duplicate(mealId: String) async throws -> LoggedMeal {
    try await send("POST", "/api/meals/\(mealId)/duplicate", body: Self.now())
  }

  /// Runs the AI analysis on a dictated description.
  func logMeal(text: String) async throws -> LoggedMeal {
    var body = Self.now()
    body["text"] = text
    return try await send("POST", "/api/meals", body: body, timeout: 90)
  }

  func deleteMeal(id: String) async throws {
    let _: Empty = try await send("DELETE", "/api/meals/\(id)")
  }

  func craving(what: String) async throws -> CravingHelp {
    let now = Self.now()
    return try await send("POST", "/api/cravings", body: ["at": now["eatenAt"]!, "localDate": now["localDate"]!, "what": what, "intensity": 2], timeout: 60)
  }

  func settleCraving(id: String, resisted: Bool) async throws {
    let _: Empty = try await send("PATCH", "/api/cravings/\(id)", body: ["outcome": resisted ? "resisted" : "gave_in"])
  }

  // MARK: Plumbing

  private struct Empty: Decodable {}

  /// `eatenAt` is local time with its offset (2026-10-30T16:05:00+01:00), `localDate` the local day.
  private static func now() -> [String: Any] {
    let formatter = ISO8601DateFormatter()
    formatter.timeZone = .current
    formatter.formatOptions = [.withInternetDateTime]
    let date = Date()
    return ["eatenAt": formatter.string(from: date), "localDate": LocalDay.string(date)]
  }

  private func send<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil, timeout: TimeInterval = 20) async throws -> T {
    guard let url = URL(string: credentials.serverUrl + path) else { throw Failure.server("Bad server URL") }
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "accept")
    request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "authorization")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "content-type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw Failure.offline
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    if status == 401 { throw Failure.unauthorized }
    guard (200 ..< 300).contains(status) else {
      let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error.message
      throw Failure.server(message ?? "HTTP \(status)")
    }
    if status == 204 || data.isEmpty, let empty = Empty() as? T { return empty }
    return try JSONDecoder().decode(T.self, from: data)
  }

  private struct ErrorBody: Decodable {
    struct Detail: Decodable { var message: String? }
    var error: Detail
  }
}

/// The part of `Meal` the watch shows after logging one.
struct LoggedMeal: Decodable, Equatable {
  struct Item: Decodable, Equatable { var emoji: String? }
  var id: String
  var title: String
  var items: [Item]
  var totals: [String: Double]

  var emoji: String { items.lazy.compactMap(\.emoji).first { !$0.isEmpty } ?? "🍽️" }
}

struct CravingHelp: Decodable, Equatable {
  struct Craving: Decodable, Equatable {
    var id: String
    var tip: String?
  }

  var craving: Craving
  var alternative: String
}
