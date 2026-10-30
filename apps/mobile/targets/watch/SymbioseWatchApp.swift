import SwiftUI
import WatchKit

@main
struct SymbioseWatchApp: App {
  @WKApplicationDelegateAdaptor private var delegate: AppDelegate

  var body: some Scene {
    WindowGroup {
      RootView().environment(WatchModel.shared)
    }
  }
}

final class AppDelegate: NSObject, WKApplicationDelegate {
  func applicationDidFinishLaunching() {
    #if DEBUG
      DebugHooks.injectCredentials()
    #endif
    Connectivity.shared.activate()
    BackgroundRefresh.schedule()
  }

  func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
    for task in backgroundTasks {
      switch task {
      case let refresh as WKApplicationRefreshBackgroundTask:
        Task { @MainActor in
          await WatchModel.shared.refresh()
          BackgroundRefresh.schedule()
          refresh.setTaskCompletedWithSnapshot(false)
        }
      case let connectivity as WKWatchConnectivityRefreshBackgroundTask:
        Connectivity.shared.hold(connectivity)
      case let snapshot as WKSnapshotRefreshBackgroundTask:
        snapshot.setTaskCompleted(restoredDefaultState: true, estimatedSnapshotExpiration: .distantFuture, userInfo: nil)
      default:
        task.setTaskCompletedWithSnapshot(false)
      }
    }
  }
}

struct RootView: View {
  @Environment(WatchModel.self) private var model
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      if model.signedIn {
        HomeView()
      } else {
        ConnectView()
      }
    }
    .animation(.smooth, value: model.signedIn)
    .onChange(of: scenePhase, initial: true) { _, phase in
      if phase == .active { Task { await model.refresh() } }
    }
  }
}
