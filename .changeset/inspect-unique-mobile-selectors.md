---
"@kraken-e2e/cli": minor
"@kraken-e2e/driver-android": patch
---

Make `kraken inspect` recommend locators that identify exactly ONE element on
mobile. The inspector now parses the page source into an element tree and ranks
locators by UNIQUENESS across the whole screen instead of by strategy type
alone: a `resource-id` shared across a list or navigation bar (`titleTextView`,
`navigation_bar_item_…`) is demoted and flagged, and the recommended locator
becomes the unique visible text or, for a tappable container with no unique id
of its own, the child label that names it. When nothing is unique it emits a
disambiguated native selector — an indexed `UiSelector` (by resource-id or
content-desc) on Android, an indexed class chain on iOS. Works for XML/Java
views, Jetpack Compose and Flutter (content-desc only), and iOS. In the mirror,
each candidate shows a recommended/unique/matches-N badge and the generated
Page Object snippet follows the candidate you click.

Also: on Android, an unqualified `testId` now resolves to a resource-id that
matches both the classic `pkg:id/name` shape and a bare Compose
`testTagsAsResourceId` id, with the value regex-escaped.
