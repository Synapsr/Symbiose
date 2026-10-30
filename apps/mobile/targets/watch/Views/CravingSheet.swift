import SwiftUI

/// « J'ai une envie », like the phone's control: name it, get a tip, ride it out.
struct CravingSheet: View {
  /// Already named (the DEBUG demo hook); otherwise the person picks one.
  var initial: String?
  /// Gave in after all: hand the words to the dictation flow.
  let onDictate: (String) -> Void

  @Environment(WatchModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var phase = Phase.choosing

  enum Phase: Equatable { case choosing, thinking, tip(CravingHelp), beaten, gaveIn, failed(String) }

  var body: some View {
    let copy = model.copy
    ScrollView {
      VStack(alignment: .leading, spacing: 8) {
        switch phase {
        case .choosing:
          Text(copy.cravingWhat).font(.rounded(17, .bold)).padding(.leading, 4)
          ForEach(copy.cravingChoices, id: \.self) { choice in
            Button {
              Haptic.tap()
              Task { await ask(choice) }
            } label: {
              Text(choice)
                .font(.rounded(16, .semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(Capsule().fill(Palette.surface2))
            }
            .buttonStyle(Pressable())
          }
        case .thinking:
          ProgressView().frame(maxWidth: .infinity, minHeight: 120)
        case let .tip(help):
          section(copy.cravingTip, systemImage: "sparkles", color: Palette.accent, text: help.craving.tip ?? "")
          section(copy.cravingAlternative, systemImage: "lightbulb", color: Palette.warning, text: help.alternative)
          Button {
            Task { await settle(help, resisted: true) }
          } label: {
            Text(copy.cravingResisted).font(.rounded(16, .semibold)).frame(maxWidth: .infinity)
          }
          .tint(Palette.accent)
          .buttonStyle(.borderedProminent)
          Button(copy.cravingGaveIn) { Task { await settle(help, resisted: false) } }
        case .beaten:
          VStack(spacing: 6) {
            Text("💪").font(.system(size: 44))
            Text(copy.cravingBeaten).font(.rounded(17, .bold))
          }
          .frame(maxWidth: .infinity, minHeight: 140)
          .transition(.scale(scale: 0.8).combined(with: .opacity))
        case .gaveIn:
          Text(copy.cravingGaveInHint).font(.rounded(15, .medium)).padding(.horizontal, 4)
          TextFieldLink(prompt: Text(copy.dictatePrompt)) {
            Label(copy.dictate, systemImage: "mic.fill").frame(maxWidth: .infinity)
          } onSubmit: { text in
            let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { onDictate(text) }
          }
          .tint(Palette.accent)
        case let .failed(message):
          Text(message).font(.rounded(14, .medium)).foregroundStyle(Palette.warning)
          Button(copy.retry) { phase = .choosing }
        }
      }
      .animation(.smooth, value: phase)
    }
    .task {
      if let initial, phase == .choosing { await ask(initial) }
    }
  }

  private func section(_ title: String, systemImage: String, color: Color, text: String) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Label(title, systemImage: systemImage).font(.rounded(12, .semibold)).foregroundStyle(color)
      Text(text).font(.rounded(15, .medium))
    }
    .padding(10)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.surface2))
  }

  private func ask(_ what: String) async {
    phase = .thinking
    do {
      phase = .tip(try await model.craving(what))
    } catch {
      Haptic.failure()
      phase = .failed(model.message(for: error))
    }
  }

  private func settle(_ help: CravingHelp, resisted: Bool) async {
    do {
      try await model.settleCraving(help, resisted: resisted)
      if resisted {
        Haptic.success()
        phase = .beaten
        try? await Task.sleep(for: .seconds(1.6))
        dismiss()
      } else {
        phase = .gaveIn
      }
    } catch {
      Haptic.failure()
      phase = .failed(model.message(for: error))
    }
  }
}
