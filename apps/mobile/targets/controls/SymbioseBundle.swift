import SwiftUI
import WidgetKit

/// Everything the extension shows: the day at a glance (Home Screen, Lock
/// Screen, StandBy), the « surfer l'envie » Live Activity and the iOS 18 controls.
@main
struct SymbioseControls: WidgetBundle {
  var body: some Widget {
    TodayWidget()
    CravingLiveActivity()
    CaptureMealControl()
    CravingControl()
  }
}
