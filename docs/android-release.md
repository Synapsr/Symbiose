# Android release (Google Play internal testing)

How to ship the Android app to a Google Play tester group. Nothing here needs EAS, but EAS works too (last section).

The app is configured for Play in `apps/mobile/app.json`:

| | |
| --- | --- |
| Package | `io.synapsr.symbiose` (cannot change once uploaded) |
| `android.versionCode` | `1`. Play refuses an upload whose `versionCode` isn't higher than every earlier one: bump it for each upload (it is independent from iOS's `buildNumber`). `versionName` comes from `expo.version`. |
| SDK levels | compile 37, target 36 (React Native 0.88 defaults), min 26 (Health Connect) |
| Signing | `plugins/with-android-signing.js` signs release builds with the upload key described below, and falls back to the debug key when it isn't there |
| Cleartext HTTP | allowed (`usesCleartextTraffic`), so a server reached as `http://192.168.x.x:3000`, the README's quick start, works as on iOS. Prefer HTTPS for anything outside the home network. |

## 1. The upload key (once, on your machine)

Google Play App Signing keeps the real app signing key. You only sign uploads with an **upload key**, which Google can reset if it is ever lost.

```bash
mkdir -p ~/.symbiose && cd ~/.symbiose
keytool -genkeypair -v -storetype PKCS12 -keystore symbiose-upload.jks \
  -alias symbiose-upload -keyalg RSA -keysize 2048 -validity 10000
```

Keep `symbiose-upload.jks` and its passwords out of git, in a password manager, with a backup.

Tell Gradle where it is in `~/.gradle/gradle.properties` (your home folder, not the repo):

```properties
SYMBIOSE_UPLOAD_STORE_FILE=/Users/you/.symbiose/symbiose-upload.jks
SYMBIOSE_UPLOAD_STORE_PASSWORD=…
SYMBIOSE_UPLOAD_KEY_ALIAS=symbiose-upload
SYMBIOSE_UPLOAD_KEY_PASSWORD=…
```

On a CI runner, the same four values can come from environment variables named `ORG_GRADLE_PROJECT_SYMBIOSE_UPLOAD_STORE_FILE` and so on.

## 2. Build the signed bundle

```bash
cd apps/mobile
npx expo prebuild --platform android --clean
cd android
EXPO_PUBLIC_SERVER_URL=https://cloud.symbiose.synapsr.io ./gradlew app:bundleRelease
```

- `EXPO_PUBLIC_SERVER_URL` pre-fills the server on the welcome screen, as for TestFlight. Leave it out for a build that asks for the server.
- The bundle is `android/app/build/outputs/bundle/release/app-release.aab`.
- Check it is signed with the upload key, not the debug one: `keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab` must show your certificate, not `CN=Android Debug`.
- `android/` is generated (git-ignored): never edit it, change `app.json` or a config plugin and prebuild again.
- To try a release build on a phone first: `./gradlew app:assembleRelease`, then `adb install -r app/build/outputs/apk/release/app-release.apk`.

## 3. Play Console: first upload and testers

1. Create the app in [Play Console](https://play.google.com/console): name Symbiose, default language French, app, free.
2. **Testing → Internal testing → Create new release.** Accept Play App Signing (Google generates and keeps the app signing key), upload `app-release.aab`, add release notes, save, review, start rollout.
3. **Testers** tab: create an email list (the testers' Google accounts), save, then copy the **opt-in link** and send it to them. Internal testing allows up to 100 testers and is available within minutes, without review.
4. Each later upload: bump `android.versionCode`, rebuild, create a new internal release.

Internal testing still needs the **App content** section filled in before the first rollout. The answers for Symbiose follow.

## 4. App content (Play Console → Policy → App content)

### Privacy policy

A public URL is required (the app requests camera, microphone and health permissions). The website has none yet: publish one (for example `symbiose.synapsr.io/privacy`) covering what is listed under *Data safety* below, the AI provider, Health Connect use, retention and deletion. Health Connect also opens "the developer's privacy policy" from its permission screen; that link currently just opens the app, which Google's Health Connect review expects to show the policy (a small follow-up for the app).

### Ads, app access, target audience

- **Ads**: no.
- **App access**: sign-in is required. Give the reviewers a test account on the server the build points to (an approved account if `SIGNUP=request`).
- **Target audience**: 18 and over (nutrition and weight goals). Not designed for children.
- **Content rating** (IARC questionnaire): category *Reference, news, or educational* or *Utility*; no violence, sexuality, gambling, drugs or user-to-user communication (the coach is an AI, not other users). Expected result: rated for everyone / PEGI 3.
- **News app**: no. **Government app**: no. **Financial features**: none.
- **Health apps declaration**: yes. Features: nutrition and diet tracking, fitness and activity, sleep, weight, blood pressure and heart rate variability. Not a medical device, no diagnosis.

### Health Connect declaration

The app requests these Health Connect permissions, each for a feature the person turns on:

| Permission | Why |
| --- | --- |
| READ steps, active calories burned, exercise | Activity-aware daily energy budget and workouts on Today |
| READ weight, height | Pre-fill the profile, keep targets accurate |
| WRITE nutrition | Each logged meal is saved to Health Connect |
| READ sleep | « Sommeil » module (opt-in) |
| READ / WRITE hydration | « Hydratation » module (opt-in) |
| READ / WRITE blood pressure | « Tension » module (opt-in) |
| READ heart rate variability, resting heart rate | Morning check-in of the proactive coach (opt-in) |

Health data is never used for ads, never sold, and only sent to the user's Symbiose server and, as context, to the AI provider that writes the coach's answers.

### Data safety

Answers for the build that points to the hosted server (a self-hosted server is the user's own: the developer receives nothing).

- **Does the app collect or share user data?** Yes, it collects. It does not share: the AI provider processes data on the developer's behalf (a service provider), which Play doesn't count as sharing.
- **Encrypted in transit:** yes (HTTPS to the hosted server).
- **Deletion:** yes, in the app (Moi → Supprimer mon compte, which deletes the account and all its data). Play also asks for a web link where a person can request deletion: publish one with the privacy policy.
- **Advertising ID, analytics, crash reporting, ads:** none (no AD_ID permission, no analytics SDK).

| Data type (Play category) | Collected | Required or optional | Purpose |
| --- | --- | --- | --- |
| Email address (Personal info) | Yes | Required (account) | Account management |
| Name (Personal info) | Yes (first name) | Required | App functionality, personalization |
| Health info (Health and fitness) | Yes: meals and nutrition, weight, height, sex, birth year, blood pressure, heart rate variability, resting heart rate, sleep, mood, symptoms, medication and journal notes | Optional, except the meals that are the app's purpose | App functionality, personalization |
| Fitness info (Health and fitness) | Yes: steps, active energy, workouts | Optional | App functionality, personalization |
| Photos (Photos and videos) | Yes: meal photos | Optional (text or barcode work too) | App functionality |
| Other user-generated content (App activity) | Yes: meal descriptions, coach conversations, notes, cravings | Optional | App functionality, personalization |
| Voice or sound recordings (Audio) | No: dictation goes through Android's speech recognition service (Google's on most phones) and only the text reaches Symbiose | | |
| Location, contacts, messages, financial info, device or other IDs, web browsing, calendar, files | No | | |

All collected data is processed ephemerally by the AI provider (Anthropic by default) to analyse a meal or write a coach reply; it is stored only on the Symbiose server.

### Permissions in the manifest

Requested at runtime, when the feature is used: camera (photo and barcode), microphone (dictation), notifications (proactive coach, Android 13+), Health Connect (above).

Install-time: internet, network state, vibrate (haptics), wake lock and boot completed (scheduled coach notifications survive a restart), modify audio settings (feedback sounds), biometric (unused, from `expo-secure-store`).

Removed with `android.blockedPermissions`: overlay (`SYSTEM_ALERT_WINDOW`, only the dev menu needs it), external storage (the photo picker needs none), Firebase push (`c2dm.RECEIVE`, local notifications only) and the Play install referrer.

No exact alarms: notifications are scheduled inexactly, so there is no `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` declaration to make.

## With EAS instead

`npx eas-cli@latest build --platform android --profile production` builds the AAB in the cloud. On the first build EAS offers to generate the upload keystore and keeps it in your Expo account (`eas credentials -p android` downloads it). `npx eas-cli@latest submit --platform android` then uploads to the internal track with a Google service account key (Play Console → Setup → API access); set `"track": "internal"` and, to finish in the console, `"releaseStatus": "draft"` in `eas.json`. If Play refuses the API for a brand-new app, upload the first AAB by hand as in section 3.
