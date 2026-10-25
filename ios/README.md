# Tare for iOS

A native SwiftUI app for [tare.news](https://tare.news): today's edition (front page, blindspots, sections), each story as a short cited article with its coverage scale, where accounts differ and every source, and push notifications for the morning edition, the evening edition and breaking news.

The app renders what `https://tare.news/api/v1` serves (`src/api/v1.ts`); it never builds an edition itself. iOS 18+, iPhone and iPad.

## Build and test

```sh
cd ios
xcodegen generate          # Tare.xcodeproj is generated, not committed
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -project Tare.xcodeproj -scheme Tare -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

`TareTests` decodes an edition and a story saved from the live API (`TareTests/Fixtures`; refresh them when the API changes). `TareUITests` turns notifications on, waits for a push and checks that tapping it opens the story. Send the push while it waits:

```sh
xcrun simctl push booted co.xanom.tare payload.apns   # {"aps":{"alert":{"title":"Breaking","body":"…"}},"storyId":"<id>"}
```

In debug builds, launching with `-openStory <id>` opens a story directly. `tare://s/<id>` links open a story in any build.

## Push notifications

Devices register their APNs token and choices with `POST /api/v1/devices` (no account; the server keeps the token, the edition choice and whether to send breaking news). The Worker sends to APNs directly:

- **Morning edition** with the 11:00 UTC email run, **evening edition** with the 22:00 run.
- **Breaking news** after an hourly build: at most one per build, a new importance-5 front-page story covered by 5+ outlets.

The Worker needs these secrets (`wrangler secret put`), plus `APNS_TOPIC` and `APPLE_TEAM_ID`, which are already in `wrangler.jsonc`:

- `APNS_KEY`: the contents of an APNs auth key (`AuthKey_XXXX.p8`)
- `APNS_KEY_ID`: that key's ID

Until they're set, pushes are skipped and logged; nothing else breaks.

## Release (TestFlight)

On the Ramakrishna team (VTQW687WBQ) some steps need the Account Holder:

1. **App Store Connect app record**: create the app "Tare" with bundle ID `co.xanom.tare`. `scripts/testflight.sh` registers the App ID with push notifications if it doesn't exist yet. If the API refuses, the Account Holder registers it on developer.apple.com.
2. **APNs key**: Certificates, Identifiers & Profiles > Keys > new key with "Apple Push Notifications service (APNs)". Store the `.p8` in 1Password and set `APNS_KEY` / `APNS_KEY_ID` on the Worker.

Then `scripts/testflight.sh` archives, signs (distribution certificate and App Store Connect API key from 1Password, set in the gitignored `scripts/testflight.local.sh`) and uploads a build.

## Design

Same system as the site (`../DESIGN.md`): newsprint and night palettes, Libre Caslon Display headlines, Source Serif 4 text, IBM Plex Mono labels, one brass accent, no color for political sides. The fonts are bundled under the SIL Open Font License (`Tare/Resources/Fonts/OFL-*.txt`).
