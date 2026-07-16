Feature: Cross-device messaging (real Android emulator ↔ real iOS simulator)
  THE M1 EXIT DEMO (ADR-0001 §7): one scenario choreographs a message composed
  on a real Android device and verified on a real iOS device, synchronized and
  carried by Kraken's signal bus. Steps run in text order (the screenplay);
  the explicit signal wait is the cross-device hop.

  Scenario: text composed on Android reaches iOS through the signal bus
    When alice opens the forms screen
    And alice writes "hola desde el emulador Android"
    And alice transmits the composed text
    Then bob opens the forms screen
    And bob receives the transmitted text within 2m
    And bob types the received text
    Then bob sees the received text mirrored within 15s
