import SwiftUI

/// One tap logs the meal again: a short undo window, then the duplicate.
struct RelogSheet: View {
  let meal: GlanceRelog

  @Environment(WatchModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var phase = Phase.waiting
  @State private var countdown: CGFloat = 1

  enum Phase: Equatable { case waiting, sending, done, failed(String) }

  private static let undoWindow: Double = 2.4

  var body: some View {
    let copy = model.copy
    VStack(spacing: 6) {
      MealBadge(emoji: meal.emoji, progress: phase == .waiting ? countdown : 1, done: phase == .done, busy: phase == .sending)
      Text(meal.title)
        .font(.rounded(16, .semibold))
        .multilineTextAlignment(.center)
        .lineLimit(2)
      MealDetail(kcal: meal.kcal, hero: meal.hero, glance: model.glance, hideCalories: model.hideCalories, copy: copy)
      Group {
        switch phase {
        case .waiting:
          Button(copy.undo) {
            Haptic.tap()
            dismiss()
          }
        case .sending:
          Text(copy.adding).font(.rounded(14, .medium)).foregroundStyle(Palette.text2).frame(minHeight: 44)
        case .done:
          Text(copy.logged).font(.rounded(15, .semibold)).foregroundStyle(Palette.accent).frame(minHeight: 44)
        case let .failed(message):
          VStack(spacing: 4) {
            Text(message).font(.rounded(12, .medium)).foregroundStyle(Palette.warning).multilineTextAlignment(.center)
            Button(copy.retry) { Task { await send() } }
          }
        }
      }
      .padding(.top, 4)
      .transition(.opacity)
    }
    .animation(.smooth, value: phase)
    .task {
      withAnimation(.linear(duration: Self.undoWindow)) { countdown = 0 }
      // Closing the sheet cancels the task, and with it the meal.
      try? await Task.sleep(for: .seconds(Self.undoWindow))
      guard !Task.isCancelled else { return }
      await send()
    }
  }

  private func send() async {
    phase = .sending
    do {
      _ = try await model.relog(meal)
      Haptic.success()
      phase = .done
      try? await Task.sleep(for: .seconds(1.1))
      dismiss()
    } catch {
      Haptic.failure()
      phase = .failed(model.message(for: error))
    }
  }
}

/// The meal's emoji inside a thin ring: a countdown, a spinner, then a check.
struct MealBadge: View {
  let emoji: String
  var progress: CGFloat = 1
  var done = false
  var busy = false

  var body: some View {
    ZStack {
      Circle().stroke(.white.opacity(0.12), lineWidth: 4)
      Circle()
        .trim(from: 0, to: progress)
        .stroke(Palette.accent, style: StrokeStyle(lineWidth: 4, lineCap: .round))
        .rotationEffect(.degrees(-90))
      if done {
        Image(systemName: "checkmark")
          .font(.rounded(28, .bold))
          .foregroundStyle(Palette.accent)
          .transition(.scale(scale: 0.6).combined(with: .opacity))
      } else if busy {
        ProgressView()
      } else {
        Text(emoji.isEmpty ? "🍽️" : emoji).font(.system(size: 30))
      }
    }
    .frame(width: 64, height: 64)
    .animation(.spring(response: 0.35, dampingFraction: 0.7), value: done)
  }
}
