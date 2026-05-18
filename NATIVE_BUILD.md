# Native build — iOS + Android

The web app runs as-is. This file documents how to ship the **native shells** (iOS + Android) so users get the home-screen icon, real push notifications, and Apple's deeper integrations (Siri shortcuts, share extension, etc.).

The backend native-push fanout (APNs + FCM) is already wired. Everything below is the one-time setup to get a signed `.ipa` and `.aab` in production.

## TL;DR

You need:
- An Apple Developer account ($99/yr) **— for iOS only**
- A Firebase project **— for Android only**
- A Mac with Xcode installed **— for iOS only**
- Android Studio installed **— for Android only**

Once those exist, the cycle is:

```bash
npm run build                      # build the web app
npx cap sync                       # copy build into native shells
npx cap open ios                   # opens Xcode → archive + upload
npx cap open android               # opens Android Studio → build bundle
```

## Step 1 — install Capacitor dependencies

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/push-notifications
npx cap add ios
npx cap add android
```

These create the `ios/` and `android/` folders. Both are checked into git so the same shell can be reproduced on any machine.

## Step 2 — iOS push setup (Apple Developer + APNs key)

1. **App ID.** Go to <https://developer.apple.com/account/resources/identifiers>. Create a new App ID with bundle identifier `com.contndr.app` (matching `capacitor.config.ts`). Enable the **Push Notifications** capability.

2. **APNs key.** In <https://developer.apple.com/account/resources/authkey>, click `+`. Pick "Apple Push Notifications service (APNs)" and download the `.p8` file. **You can only download it once.** Note the Key ID (10 characters) and your Team ID (visible in the top right of the developer portal).

3. **Add the .p8 to the backend.** Open the Supabase dashboard → Edge Functions → `make-server-a8b2511f` → Settings → Secrets. Add:

   | Name | Value |
   |---|---|
   | `APNS_KEY_ID` | the 10-char Key ID from step 2 |
   | `APNS_TEAM_ID` | your Apple Team ID |
   | `APNS_BUNDLE_ID` | `com.contndr.app` |
   | `APNS_PRIVATE_KEY` | full contents of the `.p8` file (paste including `-----BEGIN PRIVATE KEY-----` lines) |
   | `APNS_PRODUCTION` | `1` for App Store builds, leave unset for TestFlight |

4. **Xcode signing.** `npx cap open ios` opens Xcode. Select the `App` target → Signing & Capabilities → check **Automatically manage signing** → pick your team. Add the **Push Notifications** capability via the `+` button.

5. **Build + upload.** Product → Archive. Window → Organizer → Distribute App → App Store Connect.

## Step 3 — Android push setup (Firebase + FCM)

1. **Firebase project.** Create one at <https://console.firebase.google.com> if you don't have one. Add an Android app with package name `com.contndr.app`.

2. **Service account.** Project settings → Service accounts → Generate new private key. Download the JSON.

3. **Add to backend secrets.** In Supabase Edge Function secrets:

   | Name | Value |
   |---|---|
   | `FCM_PROJECT_ID` | the Firebase project ID |
   | `FCM_SERVICE_ACCOUNT_JSON` | the entire downloaded JSON file as a single string |

4. **`google-services.json`.** Download from Firebase → Project settings → Your apps → Android → `google-services.json`. Drop it into `android/app/google-services.json`.

5. **Build.** `npx cap open android` opens Android Studio. Build → Generate Signed Bundle. Pick the keystore you'll use for the Play Store (or create one).

## Step 4 — verify push works end-to-end

After deploying the backend (the GitHub Action does this automatically on push to `main`), test the flow:

1. Install the build on a physical device (push doesn't work in the simulator)
2. Log into the app — the Capacitor handler in `src/app/lib/nativePush.ts` will request permission and POST the token to `/devices/register`
3. Trigger any of the wired events:
   - **Reply** — send yourself a reply to an outbound campaign email
   - **Deal won** — move a pipeline deal to "Closed Won"
   - **Payment failed** — wait for a Stripe `invoice.payment_failed` (or fire it from the Stripe dashboard test mode)
   - **AI call completed** — wait for any AI call to hang up
4. The phone should buzz within seconds. If not, check the Edge Function logs for `[NATIVE-PUSH]` lines — common failures:
   - `APNS not configured` → secrets missing in step 2.3
   - `BadDeviceToken` → bundle ID mismatch between Xcode and `APNS_BUNDLE_ID`
   - `Unregistered` → app was uninstalled after registration (token auto-pruned, fine)

## What's already wired

| Component | Status |
|---|---|
| `capacitor.config.ts` | ✅ in repo |
| `@capacitor/push-notifications` JS handler | ✅ `src/app/lib/nativePush.ts` |
| `POST /devices/register` backend route | ✅ stores tokens in KV |
| APNs sender (ES256 JWT + HTTP/2) | ✅ `native-push.tsx` |
| FCM sender (service-account OAuth + v1 API) | ✅ `native-push.tsx` |
| Reply received → push fanout | ✅ `inbox.tsx` |
| Deal won → push fanout | ✅ `pipeline.tsx` |
| Payment failed → push fanout | ✅ `contndr-billing.tsx` |
| AI call completed → push fanout | ✅ `telnyx.tsx` |
| Dead-token auto-prune | ✅ on `BadDeviceToken` / `Unregistered` |

## What you still need to do

- [ ] Run `npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/push-notifications`
- [ ] Run `npx cap add ios` (creates `ios/` folder)
- [ ] Run `npx cap add android` (creates `android/` folder)
- [ ] Get the Apple Developer account, generate `.p8`, paste contents into `APNS_PRIVATE_KEY` secret
- [ ] Get the Firebase project, download service-account JSON, paste into `FCM_SERVICE_ACCOUNT_JSON` secret
- [ ] Push notifications capability enabled in Xcode
- [ ] `google-services.json` dropped into `android/app/`
- [ ] First build uploaded to TestFlight + Play Console internal track

## Troubleshooting

**"Permission denied" on iOS even after granting**
→ Check **Settings → Notifications → Contndr** on the device. Make sure "Allow Notifications" is on AND the alert style is set (banners/lock screen).

**Pushes work on TestFlight but not App Store**
→ Set `APNS_PRODUCTION=1` in Supabase secrets. The sandbox APNs endpoint only delivers to dev/TestFlight builds.

**Android pushes work but iOS doesn't**
→ Most common: `APNS_PRIVATE_KEY` was pasted with the BEGIN/END lines removed. Paste it WITH those lines. The signer handles the strip.

**Pushes arrive but tapping doesn't open the right screen**
→ The custom `data` payload from `sendNativePush` is delivered to the `pushNotificationActionPerformed` listener in `src/app/lib/nativePush.ts:107`. Extend that handler to route based on `data.type` (e.g. `email_replied` → open inbox, `deal_won` → open pipeline).
