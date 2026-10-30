#if DEBUG
  import SwiftUI

  /// Simulator-only hooks: the phone can't hand over a session to a simulated
  /// watch, so credentials (and a screen to open) come from launch arguments:
  ///
  ///     xcrun simctl launch <watch udid> io.synapsr.symbiose.watchkitapp \
  ///       -SymbioseServer http://localhost:3101 -SymbioseToken <jwt> \
  ///       [-SymbioseLocale fr|en] [-SymbioseHideCalories YES] \
  ///       [-SymbioseDemo relog|craving|craving:Sucré|gallery|"dictate:deux œufs et une tartine"] [-SymbioseScroll relog] \
  ///       [-SymbioseSignOut YES]
  enum DebugHooks {
    private static let args = UserDefaults.standard

    static func injectCredentials() {
      if args.bool(forKey: "SymbioseSignOut") {
        Credentials.clear()
        GlanceCache.clear()
      }
      if let server = args.string(forKey: "SymbioseServer"), let token = args.string(forKey: "SymbioseToken") {
        Credentials(serverUrl: server, token: token).save()
        let lang = args.string(forKey: "SymbioseLocale").flatMap(Lang.init(rawValue:)) ?? .device
        GlanceCache.save(lang: lang, hideCalories: args.bool(forKey: "SymbioseHideCalories"))
      }
      Task { @MainActor in WatchModel.shared.reload() }
    }

    /// -SymbioseScroll relog: opens the home screen scrolled to « Remanger ».
    static var scrollToRelog: Bool { args.string(forKey: "SymbioseScroll") == "relog" }

    @MainActor private static var demoShown = false

    /// The screen asked for with -SymbioseDemo, once.
    @MainActor
    static func takeDemo(glance: Glance?) -> HomeView.Flow? {
      guard !demoShown, let demo = args.string(forKey: "SymbioseDemo") else { return nil }
      let flow: HomeView.Flow? =
        switch demo {
        case "relog": glance?.relog.first.map { .relog($0) }
        case "craving": .craving(nil)
        case "gallery": .gallery
        default:
          if demo.hasPrefix("dictate:") { .dictation(String(demo.dropFirst("dictate:".count))) }
          else if demo.hasPrefix("craving:") { .craving(String(demo.dropFirst("craving:".count))) }
          else { nil }
        }
      if flow != nil { demoShown = true }
      return flow
    }
  }

  /// The four complication families, rendered in the app for screenshots:
  /// today's real glance, then the added-sugar and over-the-limit cases
  /// (-SymbioseGallery 1 or 2 opens on those).
  struct ComplicationGallery: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
      let copy = model.copy
      ScrollViewReader { scroller in
        ScrollView {
          VStack(spacing: 16) {
            ForEach(Array(samples.enumerated()), id: \.offset) { index, glance in
              VStack(spacing: 8) {
                HStack(spacing: 12) {
                  HeroCircular(metric: glance.hero, copy: copy)
                    .frame(width: 50, height: 50)
                  CornerPreview(metric: glance.hero, copy: copy)
                }
                HeroRectangular(glance: glance, copy: copy)
                  .frame(width: 168, height: 62)
                  .padding(8)
                  .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.white.opacity(0.15)))
                HeroInline(metric: glance.hero, copy: copy)
                  .font(.rounded(13, .medium))
                  .lineLimit(1)
                  .frame(width: 168)
              }
              .id(index)
            }
          }
        }
        .task { scroller.scrollTo(UserDefaults.standard.integer(forKey: "SymbioseGallery"), anchor: .top) }
      }
    }

    private var samples: [Glance] {
      var sugar = Glance.placeholder
      sugar.metrics = [
        .sample("addedSugar", unit: "g", consumed: 21, target: 25, kind: "max"),
        .sample("protein", unit: "g", consumed: 92, target: 90, kind: "min"),
        .sample("kcal", unit: "kcal", consumed: 1340, target: 2100, kind: "target"),
      ]
      sugar.hero = sugar.metrics[0]
      var over = sugar
      over.metrics[0] = .sample("addedSugar", unit: "g", consumed: 31, target: 25, kind: "max")
      over.hero = over.metrics[0]
      return [model.glance ?? .placeholder, sugar, over]
    }
  }

  /// The corner family curves its gauge along the bezel on a face; flat here.
  private struct CornerPreview: View {
    let metric: GlanceMetric
    let copy: Copy

    var body: some View {
      VStack(spacing: 4) {
        HeroCorner(metric: metric, copy: copy)
        ProgressBar(progress: metric.progress, color: Palette.hero(metric)).frame(width: 60)
      }
      .frame(width: 70, height: 50)
    }
  }
#endif
