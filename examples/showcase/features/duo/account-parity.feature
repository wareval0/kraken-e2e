Feature: One account, two platforms
  The SAME seeded QA account (same fixture seed, no data passed between
  actors) is created on Android and then used to log in on iOS — proving the
  account flows behave identically on both platforms, and that seeded
  fixtures make cross-actor data coordination unnecessary.

  Scenario: an account created on Android logs in on iOS
    Given alice has signed up with the shared QA account
    When alice signs off the "android" build for "signup-done"
    Then bob collects 1 sign-offs in publish order within 2m
    When bob logs in with the shared QA account
    Then bob is greeted with a successful login
