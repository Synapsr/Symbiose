import Foundation
import WatchConnectivity

/// On a phone without a server (`local://phone`), Symbiose runs in the iPhone
/// app: the watch's requests go there over WatchConnectivity (see
/// modules/watch-bridge). Answered at once while the iPhone app runs; out of
/// reach, a change waits in WatchConnectivity's own queue, delivered when the
/// app is next opened, and the watch says so.
enum PhoneLink {
  struct Reply {
    var status: Int
    var body: Data
  }

  static func isLocal(_ serverUrl: String) -> Bool { serverUrl.hasPrefix("local:") }

  static func send(_ method: String, _ path: String, body: Data?, timeout: TimeInterval) async throws -> Reply {
    let session = WCSession.default
    var message: [String: Any] = [
      "symbiose": "request",
      "id": UUID().uuidString,
      "method": method,
      "path": path,
      "body": body.flatMap { String(data: $0, encoding: .utf8) } ?? "",
      "sentAt": ISO8601DateFormatter().string(from: Date()),
    ]
    let changes = method != "GET"
    guard session.activationState == .activated, session.isReachable else {
      // Reading needs the iPhone; a change can wait for it.
      guard changes else { throw API.Failure.offline }
      message["queuedAt"] = message["sentAt"]
      session.transferUserInfo(message)
      throw API.Failure.queued
    }
    do {
      let reply = try await withThrowingTaskGroup(of: [String: Any].self) { group in
        group.addTask {
          try await withCheckedThrowingContinuation { continuation in
            session.sendMessage(message, replyHandler: { continuation.resume(returning: $0) }, errorHandler: { continuation.resume(throwing: $0) })
          }
        }
        group.addTask {
          try await Task.sleep(for: .seconds(timeout))
          throw API.Failure.offline
        }
        let first = try await group.next()!
        group.cancelAll()
        return first
      }
      // The iPhone app was waking without being ready: it keeps the request for later.
      if reply["queued"] as? Bool == true { throw API.Failure.queued }
      let status = (reply["status"] as? NSNumber)?.intValue ?? 0
      return Reply(status: status, body: (reply["body"] as? String)?.data(using: .utf8) ?? Data())
    } catch let failure as API.Failure {
      throw failure
    } catch {
      // The message didn't get through: a change goes into the queue instead.
      guard changes else { throw API.Failure.offline }
      session.transferUserInfo(message)
      throw API.Failure.queued
    }
  }
}
