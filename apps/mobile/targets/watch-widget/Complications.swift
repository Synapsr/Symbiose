import SwiftUI
import WidgetKit

// The key number on the watch face. The watch app fetches the glance (on
// launch, after each action, in background refresh) and reloads this
// timeline; the provider only renders what it stored in the App Group.
// Tapping a complication opens the watch app.

@main
struct SymbioseComplications: Widget {
  var body: some WidgetConfiguration {
    let copy = Copy(lang: GlanceCache.load().lang)
    return StaticConfiguration(kind: GlanceCache.complicationKind, provider: HeroProvider()) { entry in
      HeroComplication(entry: entry)
        .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName(copy.appName)
    .description(copy.lang == .fr ? "Ce qu’il te reste aujourd’hui." : "What’s left for today.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline, .accessoryCorner])
  }
}

struct HeroEntry: TimelineEntry {
  let date: Date
  let glance: Glance?
  let lang: Lang
}

struct HeroProvider: TimelineProvider {
  func placeholder(in context: Context) -> HeroEntry {
    HeroEntry(date: Date(), glance: .placeholder, lang: GlanceCache.load().lang)
  }

  func getSnapshot(in context: Context, completion: @escaping (HeroEntry) -> Void) {
    let entry = entry(at: Date())
    // The face gallery shows a sample until the phone has handed over a session.
    completion(entry.glance == nil && context.isPreview ? placeholder(in: context) : entry)
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<HeroEntry>) -> Void) {
    let now = Date()
    let midnight = LocalDay.nextMidnight(after: now)
    // At midnight the day starts over with the same targets, until the app refreshes.
    let entries = [entry(at: now), entry(at: midnight)]
    completion(Timeline(entries: entries, policy: .after(min(midnight, now.addingTimeInterval(30 * 60)))))
  }

  private func entry(at date: Date) -> HeroEntry {
    let cache = GlanceCache.load()
    return HeroEntry(date: date, glance: cache.glance(at: date), lang: cache.lang)
  }
}

struct HeroComplication: View {
  @Environment(\.widgetFamily) private var family
  let entry: HeroEntry

  var body: some View {
    let copy = Copy(lang: entry.lang)
    switch family {
    case .accessoryRectangular: HeroRectangular(glance: entry.glance, copy: copy)
    case .accessoryInline: HeroInline(metric: entry.glance?.hero, copy: copy)
    case .accessoryCorner: HeroCorner(metric: entry.glance?.hero, copy: copy)
    default: HeroCircular(metric: entry.glance?.hero, copy: copy)
    }
  }
}
