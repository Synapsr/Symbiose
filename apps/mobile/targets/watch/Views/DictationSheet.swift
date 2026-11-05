import SwiftUI

/// Wrist dictation: the words go to the meal analyst, the result comes back
/// with its calories and the hero nutrient. A misheard meal is one tap away from gone.
struct DictationSheet: View {
  let text: String

  @Environment(WatchModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var phase = Phase.analyzing

  enum Phase: Equatable { case analyzing, logged(LoggedMeal), queued, failed(String) }

  var body: some View {
    let copy = model.copy
    ScrollView {
      VStack(spacing: 6) {
        switch phase {
        case .analyzing:
          MealBadge(emoji: "", busy: true)
          Text(copy.analyzing).font(.rounded(16, .semibold))
          Text(copy.quoted(text))
            .font(.rounded(13, .medium))
            .foregroundStyle(Palette.text2)
            .multilineTextAlignment(.center)
            .lineLimit(3)
        case let .logged(meal):
          MealBadge(emoji: meal.emoji)
          Text(meal.title)
            .font(.rounded(16, .semibold))
            .multilineTextAlignment(.center)
            .lineLimit(2)
          MealDetail(kcal: meal.totals["kcal"] ?? 0, hero: heroAmount(meal), glance: model.glance, hideCalories: model.hideCalories, copy: copy)
          if let hero = model.glance?.hero, hero.nutrient != "kcal" {
            Text(copy.nutrient(hero.nutrient)).font(.rounded(12, .medium)).foregroundStyle(Palette.text3)
          }
          Button(copy.done) { dismiss() }
            .tint(Palette.accent)
            .padding(.top, 6)
          Button(copy.undo, role: .destructive) {
            Task {
              try? await model.undo(meal)
              dismiss()
            }
          }
          .buttonStyle(.plain)
          .font(.rounded(14, .medium))
          .foregroundStyle(Palette.text2)
          .frame(minHeight: 36)
        case .queued:
          // No server and the iPhone out of reach: the words wait for it.
          MealBadge(emoji: "", done: true)
          Text(copy.queued).font(.rounded(14, .medium)).multilineTextAlignment(.center)
          Button(copy.done) { dismiss() }
            .tint(Palette.accent)
            .padding(.top, 6)
        case let .failed(message):
          Image(systemName: "exclamationmark.bubble").font(.system(size: 28)).foregroundStyle(Palette.warning)
          Text(message).font(.rounded(14, .medium)).multilineTextAlignment(.center)
          Button(copy.retry) { Task { await analyze() } }.tint(Palette.accent)
        }
      }
      .frame(maxWidth: .infinity)
      .animation(.smooth, value: phase)
    }
    .task { await analyze() }
  }

  private func heroAmount(_ meal: LoggedMeal) -> Double {
    model.glance.flatMap { meal.totals[$0.hero.nutrient] } ?? 0
  }

  private func analyze() async {
    phase = .analyzing
    do {
      let meal = try await model.logMeal(text: text)
      Haptic.success()
      phase = .logged(meal)
    } catch API.Failure.queued {
      Haptic.success()
      phase = .queued
    } catch {
      Haptic.failure()
      phase = .failed(model.message(for: error))
    }
  }
}
