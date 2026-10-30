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
        LogoMark().frame(width: 28, height: 20)
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
      LogoMark().frame(width: 24, height: 17).widgetLabel { Text(copy.appName) }
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
        LogoMark().frame(width: 28, height: 20)
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

/// The two overlapping circles of the app icon.
struct LogoMark: View {
  var body: some View {
    GeometryReader { proxy in
      let d = proxy.size.height
      let shift = proxy.size.width - d
      ZStack(alignment: .leading) {
        Circle().fill(Palette.accent).frame(width: d, height: d).widgetAccentable()
        Circle().fill(Color(hex: 0xE2E2E0)).frame(width: d, height: d).offset(x: shift).opacity(0.9)
        Circle().fill(Color(hex: 0x0A0A0B)).frame(width: d * 0.47, height: d * 0.47).offset(x: shift / 2 + d * 0.265)
      }
    }
  }
}

/// "4", "1 240", "+3" once over.
private func centerValue(_ metric: GlanceMetric, _ copy: Copy) -> String {
  metric.tone == .over ? "+\(copy.value(metric))" : copy.value(metric)
}
