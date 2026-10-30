import Foundation

/// The phone's language wins (it is pushed with the credentials); the watch's own language otherwise.
enum Lang: String {
  case fr, en

  static var device: Lang { Locale.current.language.languageCode?.identifier == "fr" ? .fr : .en }
  var locale: Locale { Locale(identifier: self == .fr ? "fr_FR" : "en_US") }
}

/// Copy and number formatting, mirroring the app's i18n and `formatAmount`.
struct Copy {
  let lang: Lang

  private func t(_ fr: String, _ en: String) -> String { lang == .fr ? fr : en }

  // MARK: Nutrients

  func nutrient(_ key: String) -> String {
    switch key {
    case "kcal": t("Calories", "Calories")
    case "protein": t("Protéines", "Protein")
    case "carbs": t("Glucides", "Carbs")
    case "sugar": t("Sucres", "Sugars")
    case "addedSugar": t("Sucres ajoutés", "Added sugars")
    case "fat": t("Lipides", "Fat")
    case "satFat": t("Graisses saturées", "Saturated fat")
    case "fiber": t("Fibres", "Fiber")
    case "sodium": t("Sodium", "Sodium")
    default: key
    }
  }

  /// Fits a narrow column of the rectangular complication.
  func tiny(_ key: String) -> String {
    switch key {
    case "kcal": "kcal"
    case "protein": t("Prot.", "Prot.")
    case "carbs": t("Gluc.", "Carbs")
    case "sugar": t("Sucres", "Sugars")
    case "addedSugar": t("Sucre aj.", "Add. sugar")
    case "fat": t("Lip.", "Fat")
    case "satFat": t("Sat.", "Sat. fat")
    case "fiber": t("Fibres", "Fiber")
    case "sodium": t("Sodium", "Sodium")
    default: key
    }
  }

  // MARK: Numbers

  /// "1 240", "4", "2,5": kcal and sodium are whole, other nutrients keep one decimal under 10.
  func number(_ value: Double, nutrient: String) -> String {
    let whole = nutrient == "kcal" || nutrient == "sodium" || abs(value) >= 10
    let rounded = whole ? value.rounded() : (value * 10).rounded() / 10
    return rounded.formatted(.number.precision(.fractionLength(0 ... (whole ? 0 : 1))).locale(lang.locale))
  }

  /// "4 g", "1 240 kcal".
  func amount(_ value: Double, nutrient: String, unit: String) -> String {
    "\(number(value, nutrient: nutrient)) \(unit)"
  }

  // MARK: The hero

  /// The big number: what's left, how far over, or a check once a min is reached.
  func value(_ metric: GlanceMetric) -> String {
    metric.tone == .done ? "✓" : number(abs(metric.remaining), nutrient: metric.nutrient)
  }

  /// "kcal restantes", "g restants", "g au-dessus", "g à atteindre", "atteint".
  func caption(_ metric: GlanceMetric) -> String {
    switch metric.tone {
    case .done: return t("atteint", "reached")
    case .over: return "\(metric.unit) \(t("au-dessus", "over"))"
    case .normal:
      if metric.kind == "min" { return "\(metric.unit) \(t("à atteindre", "to go"))" }
      return "\(metric.unit) \(metric.nutrient == "kcal" ? t("restantes", "left") : t("restants", "left"))"
    }
  }

  /// One line for the inline complication: "1 240 kcal restantes", "4 g restants", "Protéines ✓".
  func inline(_ metric: GlanceMetric) -> String {
    if metric.tone == .done { return "\(nutrient(metric.nutrient)) ✓" }
    return "\(value(metric)) \(caption(metric))"
  }

  /// "Sucres ajoutés : 4 g restants", "Added sugars: 4 g left".
  func labelled(_ metric: GlanceMetric) -> String {
    "\(nutrient(metric.nutrient))\(t("\u{00A0}:", ":")) \(inline(metric))"
  }

  /// "+3 g" once over, "✓" once a min is reached, the remaining amount otherwise.
  func signed(_ metric: GlanceMetric) -> String {
    switch metric.tone {
    case .done: "✓"
    case .over: "+\(amount(abs(metric.remaining), nutrient: metric.nutrient, unit: metric.unit))"
    case .normal: amount(metric.remaining, nutrient: metric.nutrient, unit: metric.unit)
    }
  }

  // MARK: Watch app

  var appName: String { "Symbiose" }
  var connectTitle: String { t("Connecte ta montre", "Connect your watch") }
  var connectBody: String { t("Ouvre Symbiose sur ton iPhone : ta montre se connecte toute seule.", "Open Symbiose on your iPhone: your watch connects by itself.") }
  var relog: String { t("Remanger", "Eat again") }
  var relogEmpty: String { t("Tes repas habituels apparaîtront ici.", "Your usual meals will show up here.") }
  var dictate: String { t("Dicter un repas", "Dictate a meal") }
  var dictatePrompt: String { t("Qu’as-tu mangé ?", "What did you eat?") }
  var analyzing: String { t("J’analyse…", "Analyzing…") }
  var adding: String { t("J’ajoute…", "Adding…") }
  var logged: String { t("Repas ajouté", "Meal logged") }
  var undo: String { t("Annuler", "Undo") }
  var done: String { t("OK", "Done") }
  var craving: String { t("J’ai une envie", "I have a craving") }
  var cravingWhat: String { t("Envie de…", "Craving…") }
  var cravingTip: String { t("Le conseil", "The tip") }
  var cravingAlternative: String { t("Alternative", "Alternative") }
  var cravingResisted: String { t("J’ai tenu 💪", "I held on 💪") }
  var cravingGaveIn: String { t("J’ai craqué", "I gave in") }
  var cravingBeaten: String { t("Envie surmontée", "Craving beaten") }
  var cravingGaveInHint: String { t("Pas grave. Dicte-le pour garder le fil.", "No big deal. Dictate it to keep the thread.") }
  var cravingChoices: [String] {
    lang == .fr ? ["Sucré", "Chocolat", "Grignoter", "Soda", "Salé"] : ["Sweet", "Chocolate", "Snacking", "Soda", "Salty"]
  }
  var offline: String { t("Serveur injoignable.", "Server unreachable.") }
  var failed: String { t("Quelque chose a coincé.", "Something went wrong.") }
  var retry: String { t("Réessayer", "Try again") }

  /// « deux œufs », “two eggs”.
  func quoted(_ text: String) -> String {
    lang == .fr ? "«\u{00A0}\(text)\u{00A0}»" : "“\(text)”"
  }

  func updated(_ date: Date) -> String {
    let time = date.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(lang.locale))
    return t("À jour à \(time)", "Updated \(time)")
  }
}
