Feature: Cross-platform direct messaging (on fakes)
  One logical scenario choreographs three actors on three (fake) platforms.
  Steps execute in text order — the screenplay (ADR-0001 D6); the explicit
  signal wait and the background task show the two escape hatches.

  Scenario: A message composed on Android arrives on iOS and on the web
    When bob starts recording the conversation as "recording"
    And alice writes "hola desde los Andes"
    And alice taps send
    Then bob waits for the signal "message-sent" within 5s
    And bob sees the message "hola desde los Andes" on "message-cell" within 3s
    And carol sees the message "hola desde los Andes" on "feed-cell" within 3s
    Then bob's background task "recording" completes within 10s
