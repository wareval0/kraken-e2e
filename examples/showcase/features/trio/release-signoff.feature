Feature: Distributed release sign-off across three platforms
  A release ships only when Android and iOS engineers have both signed off
  and the release manager has recorded the evidence on the web dashboard.
  Three real platforms, one scenario: the sign-offs travel as payload-carrying
  signals, arrive in FIFO order, and the publication notice fans out to every
  subscriber at once.

  Scenario: both mobile platforms sign off and the board records the release
    Given carol is watching the release board
    When alice verifies the forms surface echoes "release 2.0.0 smoke"
    And alice signs off the "android" build for "2.0.0"
    And bob verifies the gesture carousel renders
    And bob signs off the "ios" build for "2.0.0"
    Then carol collects 2 sign-offs in publish order within 2m
    And carol confirms the sign-offs arrived from "alice" then "bob"
    When carol records every collected sign-off on the board
    Then carol sees 2 recorded sign-offs on the board
    When carol announces the release is published
    Then alice receives the publication notice for build "2.0.0" within 30s
    And bob receives the publication notice for build "2.0.0" within 30s
