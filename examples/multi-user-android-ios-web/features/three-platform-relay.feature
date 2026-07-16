Feature: Three-platform message relay (Android → Web → iOS)
  THE FLAGSHIP (ADR-0001 §5.3): one scenario choreographs a REAL Android
  emulator, a REAL browser and a REAL iOS simulator. The message hops
  platforms as payload-carrying signals; every step uses the SAME portable
  a11y locator strategy on all three.

  Scenario: a message composed on Android crosses web and lands on iOS
    When alice opens the composer
    And carol opens the composer
    And bob opens the composer
    And alice writes "un mensaje, tres plataformas"
    And alice relays the composed text as "android-hop"
    Then carol receives the "android-hop" relay within 2m
    And carol forwards the received text
    And carol sees the relayed text mirrored
    And carol relays the composed text as "web-hop"
    Then bob receives the "web-hop" relay within 2m
    And bob forwards the received text
    And bob sees the relayed text mirrored
