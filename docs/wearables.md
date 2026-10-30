# Watch & health integration

Symbiose talks to the phone's health store, which already aggregates what your watch measures. No vendor account or cloud API is needed.

| Platform | Store | Watches | Library |
| --- | --- | --- | --- |
| iOS | Apple Health (HealthKit) | Apple Watch, and anything that syncs to Apple Health (Garmin Connect, Withings, Oura…) | `@kingstinct/react-native-healthkit` |
| Android | Health Connect | Wear OS, Samsung, Fitbit, Garmin, Withings… | `react-native-health-connect` |

## What is synced

**Read** (once the user enables it in *Me → Watch & health*, at most every 10 minutes and on app foreground):

- steps and active energy for today,
- basal energy (iOS),
- the most recent body weight (keeps targets accurate when you use a connected scale).

They are sent to `PUT /api/activity` and stored per day.

**Write**: each logged meal is saved as nutrition samples (energy, protein, carbs, sugar, fat, saturated fat, fibre, sodium), so other apps and the watch's own nutrition views see it. Neither HealthKit nor Health Connect has an "added sugar" type: that value stays in Symbiose.

## Activity-aware budget

When the plan has *adjust for activity* on and today's active energy is known:

```
maintenance = BMR × 1.2 + 0.8 × active energy
```

instead of `BMR × activity multiplier`. Only 80 % of the measured active energy is credited because wrist-based estimates tend to run high. The budget then grows through the day as you move, and the Today screen shows a watch icon when it applies.

## Permissions

- iOS: usage descriptions are set by the config plugin in `app.json` (`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`).
- Android: `READ_STEPS`, `READ_ACTIVE_CALORIES_BURNED`, `READ_WEIGHT`, `WRITE_NUTRITION`, `minSdkVersion 26`.

Health data is optional; the app never blocks on it.

## Roadmap

- **watchOS companion** (via `@bacons/apple-targets`): complication and Smart Stack widget showing the focus metric ("12 / 25 g added sugar"), "eat again" for recent meals, dictation logging.
- **Wear OS tile** with the same content.
- **Garmin Connect IQ** widget for watches that don't sync nutrition back through Health Connect.
- Lock Screen widgets and a Live Activity while a meal is being analysed.
