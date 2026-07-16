Feature: Account lifecycle on Android with generated data
  Sign-up and login end to end with a SEEDED user fixture: the same seed
  produces the same account on every machine, so the test is reproducible
  without hardcoding credentials anywhere.

  Scenario: a generated user signs up and logs back in
    Given alice has signed up with the shared QA account
    When alice logs in with the shared QA account
    Then alice is greeted with a successful login
