# Watch, widgets and health

Symbiose talks to the phone's health store, which already gathers what your watch and scale measure. No vendor account or cloud API is needed.

| Platform | Store | Devices | Library |
| --- | --- | --- | --- |
| iOS | Apple Health (HealthKit) | Apple Watch, and anything that syncs to Apple Health (Garmin Connect, Withings, Oura…) | `@kingstinct/react-native-healthkit` |
| Android | Health Connect | Wear OS, Samsung, Fitbit, Garmin, Withings… | `react-native-health-connect` |

Health data is optional: the app never blocks on it.

## What is synced

The app connects to the store from *Me*, then syncs on open and when it comes back to the foreground (today's numbers at most every 10 minutes). Everything goes to the server, stored per day.

**Always read**, once connected:

- steps and active energy for each day, and basal energy (iOS);
- body weight, for the weight trend and adaptive energy;
- height, and on iOS sex and date of birth, to fill in the profile;
- workouts.

**Read only when you turn the module on:**

| Module | Read | Written back |
| --- | --- | --- |
| Sleep | sleep sessions (bedtime, wake time, time asleep) | |
| Hydration | water | the glasses you add |
| Blood pressure | readings (and pulse on iOS) | the readings you add |
| Morning check-in vitals | nightly heart-rate variability and resting heart rate | |

**Written**: each logged meal is saved as nutrition samples (energy, protein, carbs, sugar, fat, saturated fat, fibre, sodium), so other apps and the watch's own views see it. Neither store has an "added sugar" type: that value stays in Symbiose.

## Activity-aware budget

When the plan has *adjust for activity* on and today's active energy is known:

```
maintenance = BMR × 1.2 + 0.8 × active energy
```

instead of `BMR × activity multiplier`. Only 80 % of the measured active energy is credited because wrist-based estimates tend to run high. The budget then grows through the day as you move.

Over weeks, **adaptive energy** goes further: from what you log and how your weight trend moves, it measures what you really burn, and can nudge the budget by at most 100 kcal a week (see [architecture](architecture.md#the-ai-proposes-code-computes)).

## Apple Watch

The watch app installs with the iPhone app (watchOS 10 or later). The phone hands it the server, the session and the day's numbers through WatchConnectivity; from then on, the watch calls the server itself.

- **Home**: what's left today of the metric that matters to your goal, in its ring, with the next two metrics beside it.
- **Eat again**: your usual meals, one tap each, with a short undo.
- **Dictate a meal**: the words go to the meal analyst, and the result comes back with its calories and focus nutrient.
- **I have a craving**: name it, get a tip, ride it out.
- **Complications** (circular, rectangular, inline, corner) show the key number on the watch face.

## Widgets, controls and Live Activity (iOS)

- **« Ma journée »**: the Today ring on the Home Screen (small, medium), the Lock Screen (circular, rectangular, inline) and in StandBy. The app shares the session through the App Group (`group.io.synapsr.symbiose`), so the widget refreshes on its own.
- **Controls** for Control Center, the Lock Screen and the Action button: « Photographier un repas » and « J'ai une envie », each opening the app at the right place.
- **Live Activity**: when you log a craving, *Surf the urge* counts ten gentle minutes on the Lock Screen and in the Dynamic Island, then asks *Did it pass?*, with both answers one tap away.

There is no Wear OS app yet: on Android, watches feed Symbiose through Health Connect.

## Permissions

- **iOS**: the usage descriptions are set by the config plugins in `apps/mobile/app.json` (`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`, camera, photos, microphone and speech recognition for dictation). The app asks for the sleep, water, blood pressure and vitals types only when you turn the module on.
- **Android** (`minSdkVersion 26`): `CAMERA`, and the Health Connect permissions `READ_STEPS`, `READ_ACTIVE_CALORIES_BURNED`, `READ_WEIGHT`, `READ_HEIGHT`, `READ_EXERCISE`, `READ_BLOOD_PRESSURE`, `WRITE_BLOOD_PRESSURE`, `WRITE_NUTRITION`, `READ_SLEEP`, `READ_HYDRATION`, `WRITE_HYDRATION`, `READ_HEART_RATE_VARIABILITY` and `READ_RESTING_HEART_RATE`. As on iOS, the module ones are requested only when you turn it on.
