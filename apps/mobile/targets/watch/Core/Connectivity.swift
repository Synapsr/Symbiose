import Foundation
import WatchConnectivity
import WatchKit

/// Receives what the phone pushes with `updateApplicationContext` (see
/// modules/watch-bridge): the server, the session token, the locale, the
/// hide-calories setting and the latest glance. Sign-out sends `signedIn: false`.
final class Connectivity: NSObject, WCSessionDelegate {
  static let shared = Connectivity()

  /// Background deliveries stay open until the session has nothing left to hand over.
  private var pendingTasks: [WKWatchConnectivityRefreshBackgroundTask] = []

  func activate() {
    guard WCSession.isSupported() else { return }
    WCSession.default.delegate = self
    WCSession.default.activate()
  }

  func hold(_ task: WKWatchConnectivityRefreshBackgroundTask) {
    pendingTasks.append(task)
    completeTasksIfIdle()
    // Never keep the system waiting: it would stop waking the app.
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in self?.completeTasks() }
  }

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    let context = session.receivedApplicationContext
    Task { @MainActor in
      if !context.isEmpty { PhoneContext.apply(context) }
      self.completeTasksIfIdle()
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    Task { @MainActor in
      PhoneContext.apply(applicationContext)
      self.completeTasksIfIdle()
    }
  }

  private func completeTasksIfIdle() {
    let session = WCSession.default
    guard session.activationState == .activated, !session.hasContentPending else { return }
    completeTasks()
  }

  private func completeTasks() {
    pendingTasks.forEach { $0.setTaskCompletedWithSnapshot(false) }
    pendingTasks.removeAll()
  }
}

/// Applies one application context from the phone. Contexts carry `sentAt`, so
/// an old one (re-delivered at activation) never undoes a newer state.
enum PhoneContext {
  private static let lastAppliedKey = "watch.contextSentAt"

  @MainActor
  static func apply(_ context: [String: Any]) {
    let sentAt = (context["sentAt"] as? NSNumber)?.doubleValue ?? 0
    let defaults = UserDefaults.standard
    guard sentAt > defaults.double(forKey: lastAppliedKey) else { return }
    defaults.set(sentAt, forKey: lastAppliedKey)

    if context["signedIn"] as? Bool == true,
       let serverUrl = context["serverUrl"] as? String,
       let token = context["token"] as? String
    {
      Credentials(serverUrl: serverUrl, token: token).save()
      let lang = (context["locale"] as? String).flatMap(Lang.init(rawValue:)) ?? .device
      GlanceCache.save(lang: lang, hideCalories: context["hideCalories"] as? Bool ?? false)
      if let json = (context["glance"] as? String)?.data(using: .utf8),
         let glance = try? JSONDecoder().decode(Glance.self, from: json)
      {
        GlanceCache.save(glance)
      }
    } else {
      Credentials.clear()
      GlanceCache.clear()
    }
    GlanceCache.reloadComplications()
    WatchModel.shared.reload()
    // The phone's glance may predate something logged from the wrist: check with the server while on screen.
    if WKApplication.shared().applicationState == .active {
      Task { await WatchModel.shared.refresh() }
    }
  }
}
