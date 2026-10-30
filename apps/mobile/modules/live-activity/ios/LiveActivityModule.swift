import ExpoModulesCore

/// The JS side of the « surfer l'envie » Live Activity (see index.ts). The
/// activity itself, its attributes and its controller live in
/// CravingActivity.swift, shared with the widget extension that draws it.
public class LiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SymbioseLiveActivity")

    /// False when the person turned Live Activities off for Symbiose.
    Function("areEnabled") { () -> Bool in
      CravingActivities.enabled
    }

    AsyncFunction("startCraving") { (options: StartCravingOptions) async throws -> String? in
      let attributes = CravingActivityAttributes(
        cravingId: options.cravingId,
        startedAt: Date(timeIntervalSince1970: options.startedAt / 1000),
        endsAt: Date(timeIntervalSince1970: options.endsAt / 1000),
        copy: options.copy.attributes
      )
      return try await CravingActivities.start(attributes)
    }

    AsyncFunction("endCraving") { (cravingId: String, outcome: String?) async in
      await CravingActivities.end(cravingId: cravingId, outcome: outcome)
    }

    AsyncFunction("endStale") { (graceSeconds: Double) async in
      await CravingActivities.endStale(grace: graceSeconds)
    }
  }
}

struct StartCravingOptions: Record {
  @Field var cravingId: String = ""
  /// Milliseconds since 1970, like Date.now().
  @Field var startedAt: Double = 0
  @Field var endsAt: Double = 0
  @Field var copy: CravingCopyRecord = CravingCopyRecord()
}

struct CravingCopyRecord: Record {
  @Field var title: String = ""
  @Field var line: String = ""
  @Field var staleTitle: String = ""
  @Field var staleLine: String = ""
  @Field var resisted: String = ""
  @Field var gaveIn: String = ""
  @Field var resistedDone: String = ""
  @Field var gaveInDone: String = ""

  var attributes: CravingActivityAttributes.Copy {
    CravingActivityAttributes.Copy(
      title: title, line: line, staleTitle: staleTitle, staleLine: staleLine,
      resisted: resisted, gaveIn: gaveIn, resistedDone: resistedDone, gaveInDone: gaveInDone
    )
  }
}
