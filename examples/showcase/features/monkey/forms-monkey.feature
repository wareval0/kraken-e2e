Feature: Seeded monkey testing inside BDD
  Kraken's fuzz engine drives the SAME session contract as scripted steps,
  so a monkey run is just another scenario — with a fixed seed, the walk is
  identical on every run and machine, and any failure is replayable.

  Scenario: the forms screen survives a seeded monkey and the walk is reproducible
    When alice unleashes 25 seeded random interactions on the forms screen
    Then alice confirms the forms screen survived the monkey
    And alice confirms the monkey walk is reproducible from its seed
