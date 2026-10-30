import SwiftUI

/// The key number: what's left today of the metric that matters, inside its ring.
struct HeroRing: View {
  let metric: GlanceMetric
  let copy: Copy
  let size: CGFloat

  var body: some View {
    let stroke = size * 0.095
    let color = Palette.hero(metric)
    let value = copy.value(metric)
    ZStack {
      Circle().strokeBorder(color.opacity(0.18), lineWidth: stroke)
      Circle()
        .inset(by: stroke / 2)
        .trim(from: 0, to: min(max(metric.progress, 0.001), 1))
        .stroke(color, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .shadow(color: color.opacity(0.45), radius: 6)
      VStack(spacing: 0) {
        if metric.tone == .done {
          Image(systemName: "checkmark")
            .font(.rounded(size * 0.28, .bold))
            .foregroundStyle(color)
            .transition(.scale.combined(with: .opacity))
        } else {
          Text(value)
            .font(.rounded(size * (value.count > 4 ? 0.24 : 0.3), .bold))
            .monospacedDigit()
            .contentTransition(.numericText(value: metric.remaining))
            .minimumScaleFactor(0.6)
            .lineLimit(1)
        }
        Text(copy.caption(metric))
          .font(.rounded(size * 0.1, .medium))
          .foregroundStyle(metric.tone == .over ? Palette.warning : Palette.text2)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .padding(.horizontal, stroke * 1.6)
    }
    .frame(width: size, height: size)
    .animation(.smooth(duration: 0.9), value: metric)
    .accessibilityElement(children: .combine)
  }
}
