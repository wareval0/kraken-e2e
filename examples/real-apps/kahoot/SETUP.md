# Setup — cross-device live Kahoot

Three one-time preparations; everything else is `npx kraken run`.

## 1. The Kahoot account and quiz

- Use a throwaway account (a temporary email works — Kahoot does not verify it).
- Sign in once at <https://kahoot.com> and create a kahoot named exactly
  **`Kraken e2e`** with one quiz question whose correct answer sits on the
  **Diamond** tile (the shape labels — Triangle, Diamond, Circle, Square — are
  what the native app exposes to automation).
- Wire the environment files:

  ```bash
  cp .env.example .env            # shared, non-secret (the start URL)
  cp .env.host.example .env.host  # the host's credentials — fill these in
  ```

  The player's nickname is not a secret: it lives inline in
  `kraken.config.ts` as the player's `data.nickname`.

## 2. The Android side

1. Have an AVD (default expected name `Medium_Phone_API_36.0`; override with
   `KRAKEN_ANDROID_AVD`). **It does not need to be running** — Kraken boots it
   when absent, or reuses whatever device is already connected.
2. Install the Kahoot app on it (Play Store on the emulator, or a legitimately
   obtained APK). Package: `no.mobitroll.kahoot.android`.
3. Open the app once and **sign in**; leave it on the home screen (the one
   with the **Join** button). The suite runs with `noReset`, so that signed-in
   state is reused.

## 3. The browser

Nothing to install — the web driver manages Chrome itself. Set
`KRAKEN_WEB_BROWSER=firefox` (etc.) to use another browser.

## Troubleshooting

- **"Set KAHOOT_EMAIL and KAHOOT_PASSWORD…"** — `.env.host` is missing or
  empty; copy the example and fill it in.
- **A selector stopped matching** — Kahoot shipped new markup. Run
  `npx kraken inspect host` (or `player`), click the element, paste the
  recommended locator into the owning Screen Object. One file, one line.
- **The player lands somewhere unexpected** — make sure the app was left
  signed in on its home screen; `noReset` reuses whatever state it was in.
- **Diagnosing a failed run** — `.kraken/runs/<id>/` holds the event log, a
  per-step screenshot timeline, and (on failure) every actor's screenshot and
  page source at the moment things stopped.
