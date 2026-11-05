import ExpoModulesCore
import WatchConnectivity

/// Hands the Symbiose session and the latest glance to the watch app.
/// The application context keeps only the latest dictionary, delivered when
/// the watch wakes, so there is nothing to queue on the JS side.
///
/// On a phone without a server (`local://phone`), the watch's requests come
/// here instead of going to a server: the app answers them through its own
/// API (src/lib/watch.ios.ts). Those that arrive while the app isn't running
/// wait in a queue that survives until it is.
public class WatchBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WatchBridge")

    Events("onRequest")

    OnCreate {
      WatchSession.shared.onRequest = { [weak self] request in
        self?.sendEvent("onRequest", request)
      }
      WatchSession.shared.activate()
    }

    OnStartObserving {
      WatchSession.shared.listening = true
    }

    OnStopObserving {
      WatchSession.shared.listening = false
    }

    /// Replaces the context the watch reads: `{signedIn, serverUrl, token, locale, hideCalories, glance, sentAt}`.
    Function("updateContext") { (context: [String: Any]) in
      WatchSession.shared.update(context)
    }

    /// Answers a live request from the watch: the status and the JSON body of the API's response.
    Function("reply") { (id: String, status: Int, body: String) in
      WatchSession.shared.reply(id: id, status: status, body: body)
    }

    /// The requests that arrived while the app wasn't there to answer, oldest first.
    Function("pendingRequests") { () -> [[String: String]] in
      WatchSession.shared.pendingRequests()
    }

    /// A pending request was handled: it leaves the queue.
    Function("done") { (id: String) in
      WatchSession.shared.done(id: id)
    }
  }
}

final class WatchSession: NSObject, WCSessionDelegate {
  static let shared = WatchSession()

  private let queue = DispatchQueue(label: "io.synapsr.symbiose.watch-bridge")
  /// The latest context not yet handed over: no paired watch, no watch app yet, or still activating.
  private var pending: [String: Any]?
  /// Live requests waiting for the app's answer, by id.
  private var replies: [String: ([String: Any]) -> Void] = [:]
  /// Called with each request from the watch, for the JS side.
  var onRequest: (([String: Any]) -> Void)?
  /// Whether the JS side listens: if not, a request waits in the queue.
  var listening = false

  private static let queueKey = "watch.pendingRequests"

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated { session.activate() }
  }

  func update(_ context: [String: Any]) {
    queue.async {
      self.pending = context
      self.flush()
    }
  }

  /// Runs on `queue`.
  private func flush() {
    guard let context = pending, WCSession.isSupported() else { return }
    let session = WCSession.default
    guard session.activationState == .activated else {
      activate()
      return
    }
    guard session.isPaired, session.isWatchAppInstalled else { return }
    do {
      try session.updateApplicationContext(context)
      pending = nil
    } catch {
      // Kept for the next activation or watch state change.
    }
  }

  // MARK: Requests from the watch (no server)

  /// A request the watch sent while the iPhone was reachable: answered now if the app listens, else queued.
  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    guard let request = Self.request(from: message) else { return replyHandler(["status": 400, "body": ""]) }
    queue.async {
      if self.listening, let onRequest = self.onRequest {
        self.replies[request["id"]!] = replyHandler
        onRequest(request)
      } else {
        // The app is waking without its JavaScript: the request waits for it, and the watch says so.
        self.enqueue(request)
        replyHandler(["queued": true])
      }
    }
  }

  /// A request the watch queued while the iPhone was out of reach: delivered once, kept until handled.
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    guard let request = Self.request(from: userInfo) else { return }
    queue.async {
      self.enqueue(request)
      if self.listening { self.onRequest?(request.merging(["queued": "1"]) { $1 }) }
    }
  }

  func reply(id: String, status: Int, body: String) {
    queue.async {
      self.replies.removeValue(forKey: id)?(["status": status, "body": body])
    }
  }

  func pendingRequests() -> [[String: String]] {
    queue.sync { Self.stored() }
  }

  func done(id: String) {
    queue.async {
      UserDefaults.standard.set(Self.stored().filter { $0["id"] != id }, forKey: Self.queueKey)
    }
  }

  /// Runs on `queue`.
  private func enqueue(_ request: [String: String]) {
    var stored = Self.stored()
    guard !stored.contains(where: { $0["id"] == request["id"] }) else { return }
    stored.append(request)
    UserDefaults.standard.set(stored, forKey: Self.queueKey)
  }

  private static func stored() -> [[String: String]] {
    UserDefaults.standard.array(forKey: queueKey) as? [[String: String]] ?? []
  }

  /// `{id, method, path, body}` from the watch, as strings.
  private static func request(from message: [String: Any]) -> [String: String]? {
    guard message["symbiose"] as? String == "request",
          let id = message["id"] as? String,
          let method = message["method"] as? String,
          let path = message["path"] as? String, path.hasPrefix("/api/")
    else { return nil }
    return ["id": id, "method": method, "path": path, "body": message["body"] as? String ?? "", "sentAt": message["sentAt"] as? String ?? ""]
  }

  // MARK: Session

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    queue.async { self.flush() }
  }

  /// The watch app got installed, or another watch was paired.
  func sessionWatchStateDidChange(_ session: WCSession) {
    queue.async { self.flush() }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  /// Switching watches: activate again for the new one.
  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
  }
}
