import ExpoModulesCore
import WatchConnectivity

/// Hands the Symbiose session and the latest glance to the watch app.
/// The application context keeps only the latest dictionary, delivered when
/// the watch wakes, so there is nothing to queue on the JS side.
public class WatchBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WatchBridge")

    OnCreate {
      WatchSession.shared.activate()
    }

    /// Replaces the context the watch reads: `{signedIn, serverUrl, token, locale, hideCalories, glance, sentAt}`.
    Function("updateContext") { (context: [String: Any]) in
      WatchSession.shared.update(context)
    }
  }
}

final class WatchSession: NSObject, WCSessionDelegate {
  static let shared = WatchSession()

  private let queue = DispatchQueue(label: "io.synapsr.symbiose.watch-bridge")
  /// The latest context not yet handed over: no paired watch, no watch app yet, or still activating.
  private var pending: [String: Any]?

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
