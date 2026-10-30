import SwiftUI
import WatchKit

/// What's left today, the other metrics, then the meals to eat again.
/// Dictation and the craving helper sit in the bottom bar, one tap away.
struct HomeView: View {
  @Environment(WatchModel.self) private var model
  @State private var flow: Flow?

  private enum Anchor { case relog }

  enum Flow: Identifiable {
    case relog(GlanceRelog)
    case dictation(String)
    case craving(String?)
    #if DEBUG
      case gallery
    #endif

    var id: String {
      switch self {
      case let .relog(meal): "relog-\(meal.id)"
      case let .dictation(text): "dictation-\(text)"
      case .craving: "craving"
      #if DEBUG
        case .gallery: "gallery"
      #endif
      }
    }
  }

  var body: some View {
    let copy = model.copy
    NavigationStack {
      ScrollViewReader { scroller in
        ScrollView { content(copy) }
        #if DEBUG
          .task(id: model.glance == nil) {
            if model.glance != nil, DebugHooks.scrollToRelog { scroller.scrollTo(Anchor.relog, anchor: .top) }
          }
        #endif
      }
      .navigationTitle(model.glance.map { copy.nutrient($0.hero.nutrient) } ?? copy.appName)
      .navigationBarTitleDisplayMode(.inline)
      .containerBackground(backdrop, for: .navigation)
      .toolbar { actions(copy) }
    }
    .sheet(item: $flow) { flow in
      switch flow {
      case let .relog(meal): RelogSheet(meal: meal)
      case let .dictation(text): DictationSheet(text: text)
      case let .craving(what): CravingSheet(initial: what) { text in self.flow = .dictation(text) }
      #if DEBUG
        case .gallery: ComplicationGallery()
      #endif
      }
    }
    #if DEBUG
    .task(id: model.glance?.relog.first?.mealId) {
      if let demo = DebugHooks.takeDemo(glance: model.glance) { flow = demo }
    }
    #endif
  }

  private func content(_ copy: Copy) -> some View {
    VStack(spacing: 12) {
      if let glance = model.glance {
        Today(glance: glance, copy: copy)
        RelogSection(glance: glance, copy: copy, hideCalories: model.hideCalories) { meal in
          Haptic.tap()
          flow = .relog(meal)
        }
        .id(Anchor.relog)
        .appear(3)
        footer(copy)
      } else if model.refreshing || model.problem == nil {
        ProgressView().padding(.top, 40)
      } else {
        Unreachable(message: model.problem ?? copy.failed, retry: copy.retry) { Task { await model.refresh() } }
      }
    }
    .padding(.horizontal, 4)
    .padding(.bottom, 8)
  }

  /// Craving on the left, dictation on the right: both one tap from the wrist.
  @ToolbarContentBuilder
  private func actions(_ copy: Copy) -> some ToolbarContent {
    ToolbarItemGroup(placement: .bottomBar) {
      Button {
        Haptic.tap()
        flow = .craving(nil)
      } label: {
        Image(systemName: "sparkles")
      }
      .accessibilityLabel(copy.craving)
      Spacer()
      TextFieldLink(prompt: Text(copy.dictatePrompt)) {
        Image(systemName: "mic.fill").foregroundStyle(Palette.accent)
      } onSubmit: { text in
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty { flow = .dictation(text) }
      }
      .accessibilityLabel(copy.dictate)
    }
  }

  /// A soft glow in the hero's colour, like the Today card on the phone.
  private var backdrop: LinearGradient {
    let color = model.glance.map { Palette.hero($0.hero) } ?? Palette.accent
    return LinearGradient(colors: [color.opacity(0.32), color.opacity(0.08), .black], startPoint: .top, endPoint: .center)
  }

  @ViewBuilder
  private func footer(_ copy: Copy) -> some View {
    if let problem = model.problem {
      Label(problem, systemImage: "wifi.exclamationmark")
        .font(.rounded(12, .medium))
        .foregroundStyle(Palette.warning)
        .multilineTextAlignment(.center)
    } else if let updatedAt = model.updatedAt {
      Text(copy.updated(updatedAt))
        .font(.rounded(12, .medium))
        .foregroundStyle(Palette.text3)
    }
  }
}

/// The hero ring, with the two metrics that follow it on its right (as on the
/// phone's Today card), or alone and larger when there is nothing else to show.
private struct Today: View {
  let glance: Glance
  let copy: Copy

  private static let width = WKInterfaceDevice.current().screenBounds.width

  var body: some View {
    if glance.others.isEmpty {
      HeroRing(metric: glance.hero, copy: copy, size: min(Self.width * 0.6, 128)).appear(0)
    } else {
      HStack(spacing: 10) {
        HeroRing(metric: glance.hero, copy: copy, size: min(Self.width * 0.48, 104))
        VStack(alignment: .leading, spacing: 12) {
          ForEach(Array(glance.others.enumerated()), id: \.element.id) { index, metric in
            MetricStat(metric: metric, copy: copy).appear(index + 1)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.top, 4)
      .appear(0)
    }
  }
}

/// "Calories", "1 788 kcal" and a thin bar: what's left, like the ring.
private struct MetricStat: View {
  let metric: GlanceMetric
  let copy: Copy

  var body: some View {
    let color = Palette.metric(metric)
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 4) {
        Circle().fill(Palette.nutrient(metric.nutrient)).frame(width: 6, height: 6)
        Text(copy.nutrient(metric.nutrient))
          .font(.rounded(12, .medium))
          .foregroundStyle(Palette.text2)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      Text(copy.signed(metric))
        .font(.rounded(16, .semibold))
        .monospacedDigit()
        .foregroundStyle(metric.tone == .over ? Palette.warning : .white)
        .contentTransition(.numericText(value: metric.remaining))
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      ProgressBar(progress: metric.progress, color: color, height: 4)
        .animation(.smooth(duration: 0.9), value: metric.progress)
    }
    .accessibilityElement(children: .combine)
  }
}

/// « Remanger »: the usual meals, one tap each.
private struct RelogSection: View {
  let glance: Glance
  let copy: Copy
  let hideCalories: Bool
  let onPick: (GlanceRelog) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label(copy.relog, systemImage: "arrow.counterclockwise")
        .font(.rounded(13, .semibold))
        .foregroundStyle(Palette.accent)
        .padding(.leading, 6)
        .padding(.top, 4)
      if glance.relog.isEmpty {
        Text(copy.relogEmpty)
          .font(.rounded(13, .medium))
          .foregroundStyle(Palette.text2)
          .padding(.horizontal, 6)
      }
      ForEach(glance.relog) { meal in
        Button { onPick(meal) } label: {
          MealRow(emoji: meal.emoji, title: meal.title, detail: MealDetail(kcal: meal.kcal, hero: meal.hero, glance: glance, hideCalories: hideCalories, copy: copy))
        }
        .buttonStyle(Pressable())
      }
    }
  }
}

struct MealRow: View {
  let emoji: String
  let title: String
  let detail: MealDetail

  var body: some View {
    HStack(spacing: 10) {
      Text(emoji.isEmpty ? "🍽️" : emoji)
        .font(.system(size: 22))
        .frame(width: 38, height: 38)
        .background(Circle().fill(.white.opacity(0.1)))
      VStack(alignment: .leading, spacing: 1) {
        Text(title).font(.rounded(15, .semibold)).lineLimit(2)
        detail
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Palette.surface2))
    .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
  }
}

/// "520 kcal · 12 g": calories unless hidden, then the hero nutrient in its colour.
struct MealDetail: View {
  let kcal: Double
  let hero: Double
  let glance: Glance?
  let hideCalories: Bool
  let copy: Copy

  var body: some View {
    let metric = glance?.hero
    let showHero = metric.map { $0.nutrient != "kcal" } ?? false
    HStack(spacing: 4) {
      if !hideCalories {
        Text(copy.amount(kcal, nutrient: "kcal", unit: "kcal")).foregroundStyle(Palette.text2)
      }
      if let metric, showHero {
        if !hideCalories { Text("·").foregroundStyle(Palette.text3) }
        Text(copy.amount(hero, nutrient: metric.nutrient, unit: metric.unit)).foregroundStyle(Palette.nutrient(metric.nutrient))
      }
    }
    .font(.rounded(13, .medium))
    .monospacedDigit()
    .lineLimit(1)
  }
}

private struct Unreachable: View {
  let message: String
  let retry: String
  let action: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      Image(systemName: "wifi.exclamationmark").font(.system(size: 28)).foregroundStyle(Palette.warning)
      Text(message).font(.rounded(14, .medium)).multilineTextAlignment(.center)
      Button(retry, action: action).tint(Palette.accent)
    }
    .padding(.top, 16)
  }
}

/// Scale on press, with the app's touch spring.
struct Pressable: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.96 : 1)
      .opacity(configuration.isPressed ? 0.85 : 1)
      .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
  }
}

/// Staggered, soft entrance.
private struct Appear: ViewModifier {
  let index: Int
  @State private var shown = false

  func body(content: Content) -> some View {
    content
      .opacity(shown ? 1 : 0)
      .offset(y: shown ? 0 : 8)
      .onAppear {
        withAnimation(.smooth(duration: 0.45).delay(Double(index) * 0.07)) { shown = true }
      }
  }
}

extension View {
  func appear(_ index: Int) -> some View { modifier(Appear(index: index)) }
}
