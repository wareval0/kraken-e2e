Feature: Cross-device live Kahoot quiz
  A quiz host drives a real desktop browser while a player answers from the
  native Kahoot Android app — one live game, two very different devices.

  The host signs in on the web, locates the quiz in their library (Kraken reads
  the quiz id off the page — nothing is hardcoded), and launches it live. The
  player joins with the PIN the host shares. Neither side ever races ahead of
  the other: the PIN, the lobby arrival, the question going live and the answer
  each travel between the devices as signals.

  Scenario: a mobile player joins the browser host's live game and answers
    Given host has signed in to Kahoot
    And host has located the "Kraken e2e" kahoot in their library
    When host launches it live in classic mode
    And host shares the game PIN with the players
    And player joins the shared game with their configured nickname
    And host starts the round once the player is in the lobby
    And player answers "Diamond" as soon as the question appears
    And host advances to the results once the answer is in
    Then player sees their placement and leaves the game
