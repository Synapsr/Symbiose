import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// « Surfer l'envie » on the Lock Screen and in the Dynamic Island: a gentle
/// ten-minute countdown, then « C'est passé ? », with the two outcomes one tap away.
struct CravingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CravingActivityAttributes.self) { context in
      CravingLockScreen(attributes: context.attributes, phase: CravingPhase(context.state, stale: context.isStale))
        .activityBackgroundTint(Palette.surface)
        .activitySystemActionForegroundColor(Palette.accent)
    } dynamicIsland: { context in
      let attributes = context.attributes
      let phase = CravingPhase(context.state, stale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          WaveBadge(attributes: attributes, phase: phase, size: 44)
            .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if phase == .surfing {
            CravingTimer(attributes: attributes, size: 28)
              .padding(.trailing, 4)
              .frame(maxHeight: .infinity)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text(phase.title(attributes.copy))
            .font(.system(size: 16, weight: .semibold))
            .lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          CravingBody(attributes: attributes, phase: phase)
            .padding(.top, 4)
        }
      } compactLeading: {
        Image(systemName: "water.waves")
          .font(.system(size: 14, weight: .semibold))
          .foregroundStyle(Palette.accent)
      } compactTrailing: {
        switch phase {
        case .surfing:
          CravingTimer(attributes: attributes, size: 15, width: 40)
        case .checkIn:
          Image(systemName: "questionmark.circle.fill").foregroundStyle(Palette.accent)
        case .settled:
          Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.accent)
        }
      } minimal: {
        WaveBadge(attributes: attributes, phase: phase, size: 24, filled: false)
      }
      .keylineTint(Palette.accent)
    }
  }
}

enum CravingPhase: Equatable {
  /// The countdown runs.
  case surfing
  /// Ten minutes later: « C'est passé ? ».
  case checkIn
  /// Answered, from the activity or in the app.
  case settled(resisted: Bool)

  init(_ state: CravingActivityAttributes.ContentState, stale: Bool) {
    if let outcome = state.outcome {
      self = .settled(resisted: outcome == "resisted")
    } else {
      self = stale ? .checkIn : .surfing
    }
  }

  var isSettled: Bool {
    if case .settled = self { return true }
    return false
  }

  func title(_ copy: CravingActivityAttributes.Copy) -> String {
    switch self {
    case .surfing: copy.title
    case .checkIn: copy.staleTitle
    case .settled(let resisted): resisted ? copy.resistedDone : copy.gaveInDone
    }
  }

  func line(_ copy: CravingActivityAttributes.Copy) -> String {
    self == .checkIn ? copy.staleLine : copy.line
  }
}

struct CravingLockScreen: View {
  let attributes: CravingActivityAttributes
  let phase: CravingPhase

  var body: some View {
    Group {
      if case .settled(let resisted) = phase {
        HStack(spacing: 12) {
          Text(resisted ? "💪" : "🌊").font(.system(size: 28))
          Text(phase.title(attributes.copy))
            .font(.system(size: 17, weight: .semibold))
            .lineLimit(2)
          Spacer(minLength: 0)
        }
      } else {
        VStack(alignment: .leading, spacing: 14) {
          HStack(alignment: .top, spacing: 12) {
            WaveBadge(attributes: attributes, phase: phase, size: 44)
            VStack(alignment: .leading, spacing: 2) {
              HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(phase.title(attributes.copy))
                  .font(.system(size: 17, weight: .semibold))
                  .lineLimit(1)
                Spacer(minLength: 0)
                if phase == .surfing {
                  CravingTimer(attributes: attributes, size: 26)
                }
              }
              CravingLine(text: phase.line(attributes.copy))
            }
          }
          CravingActions(attributes: attributes)
        }
      }
    }
    .padding(16)
  }
}

/// The encouraging line, and below it the two outcomes (expanded Dynamic Island).
struct CravingBody: View {
  let attributes: CravingActivityAttributes
  let phase: CravingPhase

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if !phase.isSettled {
        CravingLine(text: phase.line(attributes.copy))
        CravingActions(attributes: attributes)
      }
    }
  }
}

struct CravingLine: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(size: 13))
      .foregroundStyle(.secondary)
      .lineLimit(2)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct CravingActions: View {
  let attributes: CravingActivityAttributes

  var body: some View {
    HStack(spacing: 8) {
      Button(intent: ResistedCravingIntent(cravingId: attributes.cravingId)) {
        Text(attributes.copy.resisted)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(Palette.onAccent)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 10)
          .background(Capsule().fill(Palette.accent))
      }
      .buttonStyle(.plain)
      Button(intent: GaveInCravingIntent(cravingId: attributes.cravingId)) {
        Text(attributes.copy.gaveIn)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(.primary)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 10)
          .background(Capsule().fill(Palette.track))
      }
      .buttonStyle(.plain)
    }
  }
}

/// The countdown, in rounded tabular digits so it never jitters. A timer text
/// claims room for hours, so its width is fixed to what "10:00" needs.
struct CravingTimer: View {
  let attributes: CravingActivityAttributes
  let size: CGFloat
  var width: CGFloat?

  var body: some View {
    Text(timerInterval: attributes.startedAt...attributes.endsAt, countsDown: true)
      .font(.system(size: size, weight: .semibold, design: .rounded))
      .monospacedDigit()
      .multilineTextAlignment(.trailing)
      .foregroundStyle(Palette.accent)
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      .frame(width: width ?? size * 2.9, alignment: .trailing)
  }
}

/// A wave in a soft circle, ringed by the time left.
struct WaveBadge: View {
  let attributes: CravingActivityAttributes
  let phase: CravingPhase
  let size: CGFloat
  var filled = true

  var body: some View {
    ZStack {
      if filled { Circle().fill(Palette.accentSoft) }
      if phase == .surfing {
        ProgressView(timerInterval: attributes.startedAt...attributes.endsAt, countsDown: true) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
        .progressViewStyle(.circular)
        .tint(Palette.accent)
      }
      Image(systemName: phase == .checkIn ? "questionmark" : "water.waves")
        .font(.system(size: size * 0.4, weight: .semibold))
        .foregroundStyle(Palette.accent)
    }
    .frame(width: size, height: size)
  }
}

// MARK: - Previews

extension CravingActivityAttributes {
  static let preview = CravingActivityAttributes(
    cravingId: "preview",
    startedAt: .now,
    endsAt: .now.addingTimeInterval(10 * 60),
    copy: Copy(
      title: "Surfer l’envie",
      line: "Souvent, une envie redescend en quelques minutes.",
      staleTitle: "C’est passé ?",
      staleLine: "Dix minutes déjà. Où en est l’envie ?",
      resisted: "J’ai tenu 💪",
      gaveIn: "J’ai craqué",
      resistedDone: "Bravo, vague surfée.",
      gaveInDone: "C’est noté. On continue, sans culpabilité."
    )
  )
}

#Preview("Lock Screen", as: .content, using: CravingActivityAttributes.preview) {
  CravingLiveActivity()
} contentStates: {
  CravingActivityAttributes.ContentState()
  CravingActivityAttributes.ContentState(outcome: "resisted")
}

#Preview("Expanded", as: .dynamicIsland(.expanded), using: CravingActivityAttributes.preview) {
  CravingLiveActivity()
} contentStates: {
  CravingActivityAttributes.ContentState()
}

#Preview("Compact", as: .dynamicIsland(.compact), using: CravingActivityAttributes.preview) {
  CravingLiveActivity()
} contentStates: {
  CravingActivityAttributes.ContentState()
}
