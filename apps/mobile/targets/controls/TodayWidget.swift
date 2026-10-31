import SwiftUI
import WidgetKit

/// « Ma journée »: the Today hero on the Home Screen, the Lock Screen and in StandBy.
struct TodayWidget: Widget {
  static let kind = "io.synapsr.symbiose.widget.today"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: TodayProvider()) { entry in
      TodayWidgetView(entry: entry)
    }
    .configurationDisplayName(L10n.current.widgetName)
    .description(L10n.current.widgetDescription)
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

struct TodayEntry: TimelineEntry {
  let date: Date
  let state: TodayState
  let l10n: L10n
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: .now, state: .day(.sample, fresh: false), l10n: .current)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    if context.isPreview { return completion(placeholder(in: context)) }
    Task { completion(TodayEntry(date: .now, state: await GlanceLoader.load(network: false), l10n: .current)) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    Task {
      let now = Date.now
      let state = await GlanceLoader.load(now: now)
      let l10n = L10n.current
      var entries = [TodayEntry(date: now, state: state, l10n: l10n)]
      // The day starts over at midnight, even when the next reload comes late.
      if case .day(let glance, false) = state {
        entries.append(TodayEntry(date: LocalDay.nextMidnight(after: now), state: .day(glance, fresh: true), l10n: l10n))
      }
      completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }
  }
}

// MARK: - Families

struct TodayWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: TodayEntry

  var body: some View {
    content.containerBackground(for: .widget) { WidgetBackground(family: family, glow: glance.map { HeroStyle.tint($0.hero) }) }
  }

  @ViewBuilder private var content: some View {
    let l = entry.l10n
    switch family {
    case .accessoryInline: InlineView(glance: glance, l: l)
    case .accessoryCircular: CircularView(glance: glance, l: l)
    case .accessoryRectangular: RectangularView(glance: glance, state: entry.state, l: l)
    default:
      if let glance {
        if family == .systemMedium { MediumView(glance: glance, l: l) } else { SmallView(glance: glance, l: l) }
      } else {
        MessageView(state: entry.state, l: l, wide: family == .systemMedium)
      }
    }
  }

  /// The day as shown: after midnight it starts again from zero.
  private var glance: Glance? {
    guard case .day(let glance, let fresh) = entry.state else { return nil }
    return fresh ? glance.freshDay : glance
  }
}

/// The app's card, with the hero colour glowing softly behind the ring.
struct WidgetBackground: View {
  @Environment(\.widgetRenderingMode) private var mode
  let family: WidgetFamily
  let glow: Color?

  var body: some View {
    switch family {
    case .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge:
      ZStack {
        Palette.surface
        if let glow, mode == .fullColor {
          RadialGradient(
            colors: [glow.opacity(0.2), glow.opacity(0)],
            center: family == .systemSmall ? UnitPoint(x: 0.5, y: 0.6) : UnitPoint(x: 0.2, y: 0.6),
            startRadius: 0,
            endRadius: 120
          )
        }
      }
    default:
      Color.clear
    }
  }
}

struct SmallView: View {
  let glance: Glance
  let l: L10n

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      NutrientLabel(metric: glance.hero, l: l)
      HeroRing(metric: glance.hero, l: l, stroke: 11)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}

struct MediumView: View {
  let glance: Glance
  let l: L10n

  var body: some View {
    HStack(spacing: 18) {
      VStack(alignment: .leading, spacing: 8) {
        NutrientLabel(metric: glance.hero, l: l)
        HeroRing(metric: glance.hero, l: l, stroke: 11)
      }
      .frame(maxHeight: .infinity)

      VStack(alignment: .leading, spacing: 12) {
        if glance.extras.isEmpty {
          Text(glance.meals > 0 ? l.meals(glance.meals) : l.noMeal)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.secondary)
        }
        ForEach(glance.extras, id: \.nutrient) { MetricBar(metric: $0, l: l) }
        Spacer(minLength: 0)
        CaptureButton(l: l)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }
}

struct CircularView: View {
  let glance: Glance?
  let l: L10n

  var body: some View {
    if let metric = glance?.hero {
      Gauge(value: min(max(metric.ratio, 0), 1)) {
        Image(systemName: "leaf.fill")
      } currentValueLabel: {
        if metric.reachedMin {
          Image(systemName: "checkmark").font(.system(size: 20, weight: .bold))
        } else {
          Text(Nutrient.number(metric.nutrient, abs(metric.remaining), locale: l).replacingOccurrences(of: "\u{00A0}", with: ""))
            .font(.system(size: 17, weight: .semibold, design: .rounded))
            .minimumScaleFactor(0.6)
        }
      }
      .gaugeStyle(.accessoryCircularCapacity)
      .widgetAccentable()
    } else {
      ZStack {
        AccessoryWidgetBackground()
        SymbioseMark(size: 30)
      }
    }
  }
}

struct RectangularView: View {
  let glance: Glance?
  let state: TodayState
  let l: L10n

  var body: some View {
    if let metric = glance?.hero {
      VStack(alignment: .leading, spacing: 2) {
        Label(Nutrient.name(metric.nutrient, l), systemImage: metric.reachedMin ? "checkmark.circle.fill" : "leaf.fill")
          .font(.system(size: 13, weight: .semibold))
          .widgetAccentable()
        Text(l.sentence(metric))
          .font(.system(size: 17, weight: .semibold, design: .rounded))
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Gauge(value: min(max(metric.ratio, 0), 1)) { EmptyView() }
          .gaugeStyle(.accessoryLinearCapacity)
          .widgetAccentable()
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      VStack(alignment: .leading, spacing: 2) {
        Text(l.signedOutTitle).font(.system(size: 15, weight: .semibold)).widgetAccentable()
        Text(state == .signedOut ? l.signedOutBody : l.waitingBody)
          .font(.system(size: 13))
          .foregroundStyle(.secondary)
          .lineLimit(2)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

struct InlineView: View {
  let glance: Glance?
  let l: L10n

  var body: some View {
    if let metric = glance?.hero {
      Label(l.sentence(metric), systemImage: metric.reachedMin ? "checkmark.circle" : "leaf")
    } else {
      Label("Symbiose", systemImage: "leaf")
    }
  }
}

/// Signed out, or not synced yet: a gentle word instead of empty numbers.
struct MessageView: View {
  let state: TodayState
  let l: L10n
  let wide: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      SymbioseMark(size: 30)
      Spacer(minLength: 0)
      Text(l.signedOutTitle)
        .font(.custom("Fraunces-Bold", size: 20, relativeTo: .title3))
      Text(state == .signedOut ? l.signedOutBody : l.waitingBody)
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
        .lineLimit(3)
        .frame(maxWidth: wide ? 220 : .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Pieces

enum HeroStyle {
  /// Warning past a ceiling, otherwise the nutrient's own colour (calories: the accent).
  static func tint(_ metric: GlanceMetric) -> Color {
    metric.isOver ? Palette.warning : Nutrient.color(metric.nutrient)
  }
}

struct NutrientLabel: View {
  let metric: GlanceMetric
  let l: L10n

  var body: some View {
    HStack(spacing: 6) {
      Circle()
        .fill(Nutrient.color(metric.nutrient))
        .frame(width: 7, height: 7)
        .widgetAccentable()
      Text(Nutrient.name(metric.nutrient, l).uppercased())
        .font(.system(size: 11, weight: .bold))
        .tracking(0.8)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

/// The Today ring: the number in the middle is what is left (or past) today.
struct HeroRing: View {
  @Environment(\.widgetRenderingMode) private var mode
  let metric: GlanceMetric
  let l: L10n
  var stroke: CGFloat = 11

  var body: some View {
    let tint = HeroStyle.tint(metric)
    // Inset by half the stroke so the ring stays inside its frame (and the widget's margins).
    ZStack {
      Circle()
        .inset(by: stroke / 2)
        .stroke(mode == .fullColor ? Palette.track : Color.primary.opacity(0.18), lineWidth: stroke)
      if metric.ratio > 0 {
        Circle()
          .inset(by: stroke / 2)
          .trim(from: 0, to: min(metric.ratio, 1))
          .stroke(tint, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .widgetAccentable()
      }
      center(tint: tint)
        .padding(stroke + 3)
    }
    .aspectRatio(1, contentMode: .fit)
  }

  @ViewBuilder private func center(tint: Color) -> some View {
    if metric.reachedMin {
      VStack(spacing: 2) {
        Image(systemName: "checkmark")
          .font(.system(size: 28, weight: .bold))
          .foregroundStyle(tint)
          .widgetAccentable()
        Text(l.status(metric))
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
      }
    } else {
      VStack(spacing: 0) {
        Text(l.status(metric))
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(metric.isOver ? Palette.warning : .secondary)
        Text(Nutrient.number(metric.nutrient, abs(metric.remaining), locale: l))
          .font(.custom("Fraunces-Bold", size: 30, relativeTo: .title))
          .lineLimit(1)
          .minimumScaleFactor(0.5)
          .contentTransition(.numericText(value: metric.remaining))
        Text(metric.unit)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(.secondary)
      }
    }
  }
}

struct MetricBar: View {
  @Environment(\.widgetRenderingMode) private var mode
  let metric: GlanceMetric
  let l: L10n

  var body: some View {
    let tint = metric.isOver ? Palette.warning : Nutrient.color(metric.nutrient)
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Circle().fill(Nutrient.color(metric.nutrient)).frame(width: 7, height: 7).widgetAccentable()
        Text(Nutrient.name(metric.nutrient, l))
          .font(.system(size: 13, weight: .semibold))
          .lineLimit(1)
        Spacer(minLength: 4)
        HStack(spacing: 3) {
          Text("\(Nutrient.number(metric.nutrient, metric.consumed, locale: l)) / \(Nutrient.amount(metric, value: metric.target, locale: l))")
            .monospacedDigit()
          if metric.reachedMin { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)) }
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(metric.isOver ? Palette.warning : metric.reachedMin ? tint : .secondary)
        .lineLimit(1)
      }
      GeometryReader { proxy in
        ZStack(alignment: .leading) {
          Capsule().fill(mode == .fullColor ? Palette.track : Color.primary.opacity(0.18))
          if metric.ratio > 0 {
            Capsule()
              .fill(tint)
              .frame(width: max(6, proxy.size.width * min(metric.ratio, 1)))
              .widgetAccentable()
          }
        }
      }
      .frame(height: 6)
    }
  }
}

struct CaptureButton: View {
  let l: L10n

  var body: some View {
    Link(destination: URL(string: "symbiose://capture")!) {
      Label(l.capture, systemImage: "camera.fill")
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(Palette.onAccent)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Capsule().fill(Palette.accent).widgetAccentable())
    }
  }
}

/// The app's logo (« Bourgeon »): a cell and the bud that grows out of it. Its emerald-to-lime
/// gradient in full colour; one accent tint on the Lock Screen and in tinted modes.
struct SymbioseMark: View {
  var size: CGFloat = 30
  @Environment(\.widgetRenderingMode) private var renderingMode

  var body: some View {
    Group {
      if renderingMode == .fullColor {
        LogoMark().fill(Palette.bourgeon)
      } else {
        LogoMark().fill(Palette.accent).widgetAccentable()
      }
    }
    .frame(width: size, height: size)
  }
}

/// The Symbiose mark: one single-colour path (68.5-unit box), the same outline as the app's Logo.
struct LogoMark: Shape {
  func path(in rect: CGRect) -> Path {
    let s = min(rect.width, rect.height) / 68.5
    let ox = rect.midX - 34.25 * s
    let oy = rect.midY - 34.25 * s
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
    var p = Path()
    p.move(to: pt(49.20, 37.23))
    p.addCurve(to: pt(50.01, 33.01), control1: pt(48.82, 35.77), control2: pt(49.12, 34.23))
    p.addCurve(to: pt(53.79, 30.98), control1: pt(50.90, 31.80), control2: pt(52.29, 31.06))
    p.addCurve(to: pt(68.50, 15.24), control1: pt(62.13, 30.56), control2: pt(68.64, 23.59))
    p.addCurve(to: pt(53.26, 0.00), control1: pt(68.36, 6.88), control2: pt(61.62, 0.14))
    p.addCurve(to: pt(37.52, 14.71), control1: pt(44.91, -0.14), control2: pt(37.94, 6.37))
    p.addCurve(to: pt(35.49, 18.49), control1: pt(37.44, 16.21), control2: pt(36.70, 17.60))
    p.addCurve(to: pt(31.27, 19.30), control1: pt(34.27, 19.38), control2: pt(32.73, 19.68))
    p.addCurve(to: pt(3.30, 31.09), control1: pt(20.36, 16.47), control2: pt(8.90, 21.30))
    p.addCurve(to: pt(7.32, 61.18), control1: pt(-2.30, 40.88), control2: pt(-0.65, 53.20))
    p.addCurve(to: pt(37.41, 65.20), control1: pt(15.30, 69.15), control2: pt(27.62, 70.80))
    p.addCurve(to: pt(49.20, 37.23), control1: pt(47.20, 59.60), control2: pt(52.03, 48.14))
    p.closeSubpath()
    return p
  }
}

// MARK: - Previews

#Preview("Small", as: .systemSmall) {
  TodayWidget()
} timeline: {
  TodayEntry(date: .now, state: .day(.sample, fresh: false), l10n: L10n(fr: true))
  TodayEntry(date: .now, state: .signedOut, l10n: L10n(fr: true))
}

#Preview("Medium", as: .systemMedium) {
  TodayWidget()
} timeline: {
  TodayEntry(date: .now, state: .day(.sample, fresh: false), l10n: L10n(fr: true))
  TodayEntry(date: .now, state: .day(.sample, fresh: true), l10n: L10n(fr: true))
}

#Preview("Lock Screen", as: .accessoryRectangular) {
  TodayWidget()
} timeline: {
  TodayEntry(date: .now, state: .day(.sample, fresh: false), l10n: L10n(fr: true))
}
