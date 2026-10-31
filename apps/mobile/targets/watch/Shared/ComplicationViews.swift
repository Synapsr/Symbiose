import SwiftUI
import WidgetKit

// The four complication families. They live in Shared so the watch app can
// render them too (a DEBUG gallery used for screenshots).

struct HeroCircular: View {
  let metric: GlanceMetric?
  let copy: Copy

  var body: some View {
    if let metric {
      Gauge(value: min(max(metric.progress, 0), 1)) {
        Text(metric.unit)
      } currentValueLabel: {
        if metric.tone == .done {
          Image(systemName: "checkmark").font(.rounded(18, .bold))
        } else {
          Text(centerValue(metric, copy)).font(.rounded(18, .bold)).minimumScaleFactor(0.5)
        }
      }
      .gaugeStyle(.accessoryCircular)
      .tint(Palette.hero(metric))
      .widgetAccentable()
    } else {
      ZStack {
        AccessoryWidgetBackground()
        LogoMark().fill(Palette.accent).frame(width: 24, height: 24).widgetAccentable()
      }
    }
  }
}

struct HeroCorner: View {
  let metric: GlanceMetric?
  let copy: Copy

  var body: some View {
    if let metric {
      Group {
        if metric.tone == .done {
          Image(systemName: "checkmark").font(.rounded(20, .bold))
        } else {
          Text(centerValue(metric, copy)).font(.rounded(20, .bold)).minimumScaleFactor(0.6)
        }
      }
      .foregroundStyle(Palette.hero(metric))
      .widgetCurvesContent()
      .widgetLabel {
        Gauge(value: min(max(metric.progress, 0), 1)) {
          Text(metric.unit)
        } currentValueLabel: {
          Text(metric.unit)
        } minimumValueLabel: {
          Text("")
        } maximumValueLabel: {
          Text(metric.unit)
        }
        .tint(Palette.hero(metric))
      }
    } else {
      LogoMark().fill(Palette.accent).frame(width: 20, height: 20).widgetAccentable().widgetLabel { Text(copy.appName) }
    }
  }
}

struct HeroInline: View {
  let metric: GlanceMetric?
  let copy: Copy

  var body: some View {
    if let metric {
      if metric.nutrient == "kcal" || metric.tone == .done {
        Text(copy.inline(metric))
      } else {
        // Longest first; the face keeps the first one that fits.
        ViewThatFits {
          Text(copy.labelled(metric))
          Text("\(copy.tiny(metric.nutrient)) \(copy.signed(metric))")
          Text(copy.inline(metric))
        }
      }
    } else {
      Text(copy.appName)
    }
  }
}

/// Label, bar and value for each metric, the hero first.
struct HeroRectangular: View {
  let glance: Glance?
  let copy: Copy

  var body: some View {
    if let glance, glance.metrics.count > 1 {
      VStack(alignment: .leading, spacing: 4) {
        ForEach(glance.metrics.prefix(3)) { metric in
          MetricLine(metric: metric, copy: copy, isHero: metric.nutrient == glance.hero.nutrient)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    } else if let hero = glance?.hero {
      VStack(alignment: .leading, spacing: 2) {
        Text(copy.nutrient(hero.nutrient)).font(.rounded(13, .medium)).foregroundStyle(Palette.text2)
        HStack(alignment: .firstTextBaseline, spacing: 4) {
          Text(copy.value(hero)).font(.rounded(26, .bold)).foregroundStyle(Palette.hero(hero)).widgetAccentable()
          Text(copy.caption(hero)).font(.rounded(13, .medium)).foregroundStyle(Palette.text2)
        }
        ProgressBar(progress: hero.progress, color: Palette.hero(hero))
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    } else {
      HStack(spacing: 8) {
        LogoMark().fill(Palette.accent).frame(width: 22, height: 22).widgetAccentable()
        VStack(alignment: .leading, spacing: 0) {
          Text(copy.appName).font(.rounded(15, .semibold))
          Text(copy.connectTitle).font(.rounded(12, .medium)).foregroundStyle(Palette.text2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

private struct MetricLine: View {
  let metric: GlanceMetric
  let copy: Copy
  let isHero: Bool

  var body: some View {
    let color = isHero ? Palette.hero(metric) : Palette.metric(metric)
    HStack(spacing: 6) {
      Text(copy.tiny(metric.nutrient))
        .font(.rounded(13, isHero ? .bold : .medium))
        .foregroundStyle(isHero ? .primary : Palette.text2)
        .lineLimit(1)
        .frame(width: 54, alignment: .leading)
      ProgressBar(progress: metric.progress, color: color)
      Text(copy.signed(metric))
        .font(.rounded(13, isHero ? .bold : .medium))
        .monospacedDigit()
        .foregroundStyle(metric.tone == .done ? Palette.accent : isHero || metric.tone == .over ? color : .primary)
        .lineLimit(1)
        .fixedSize()
    }
  }
}

/// A thin capsule bar; full and amber once over.
struct ProgressBar: View {
  let progress: Double
  let color: Color
  var height: CGFloat = 4

  var body: some View {
    GeometryReader { proxy in
      ZStack(alignment: .leading) {
        Capsule().fill(.white.opacity(0.18))
        Capsule().fill(color).frame(width: max(height, proxy.size.width * min(max(progress, 0), 1))).widgetAccentable()
      }
    }
    .frame(height: height)
  }
}

/// The app's logo (« Bourgeon », Graphite): the cell in ink and the bud as the only light.
/// The watch app's views are in full colour; complications in a tinted face get the accent.
struct SymbioseMark: View {
  var size: CGFloat = 30
  @Environment(\.widgetRenderingMode) private var renderingMode

  var body: some View {
    let s = size / 68.5
    Group {
      if renderingMode == .fullColor {
        ZStack {
          LogoMark().fill(Palette.markInk)
          // The bud: centre (53, 15.5), radius 15.5 in the 68.5 box.
          Circle()
            .fill(Palette.budLight(radius: 22.3 * s))
            .frame(width: 31 * s, height: 31 * s)
            .offset(x: 18.75 * s, y: -18.75 * s)
        }
      } else {
        LogoMark().fill(Palette.accent).widgetAccentable()
      }
    }
    .frame(width: size, height: size)
  }
}

/// The Symbiose mark (« Bourgeon »): a cell and its bud, one single-colour path (68.5-unit box),
/// so it works in every widget rendering mode. The same outline as the app's Logo.
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

/// "4", "1 240", "+3" once over.
private func centerValue(_ metric: GlanceMetric, _ copy: Copy) -> String {
  metric.tone == .over ? "+\(copy.value(metric))" : copy.value(metric)
}
