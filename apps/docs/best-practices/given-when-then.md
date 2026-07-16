# Given/When/Then discipline

Kraken features are specifications first and test scripts second. The suite stays maintainable when every scenario reads as a statement about the product's behavior, in domain language, with the interaction mechanics pushed down into steps and page objects. The conventions below are the ones Kraken's own example suites follow.

## The three keywords carry meaning

- **Given** establishes context — state that exists before the interesting behavior. Account creation, an open dashboard, a device on the right screen.
- **When** performs the action under test — what the actor *does*.
- **Then** asserts an observable outcome — what the actor *sees* or *receives*. A `Then` step never mutates state.

`And`/`But` continue whichever keyword preceded them.

```gherkin
Scenario: both mobile platforms sign off and the board records the release
  Given carol is watching the release board
  When alice verifies the forms surface echoes "release 2.0.0 smoke"
  And alice signs off the "android" build for "2.0.0"
  And bob verifies the gesture carousel renders
  And bob signs off the "ios" build for "2.0.0"
  Then carol collects 2 sign-offs in publish order within 2m
  And carol confirms the sign-offs arrived from "alice" then "bob"
```

## Declarative over imperative

Write what the actor accomplishes, not which controls they touch. UI mechanics belong in step definitions and page objects, where they can change without rewriting features.

```gherkin
# Prefer — survives a redesign of the login screen:
When alice logs in with the shared QA account

# Avoid — couples the specification to widget structure:
When alice taps the "login" tab
And alice types "user@example.com" into the "email" field
And alice types "secret" into the "password" field
And alice taps the "LOGIN" button
```

## One actor per step

Every Kraken step is addressed to exactly one actor — the compiler enforces it. This is not a restriction to work around; it is what makes a multi-device scenario legible. When a fact belongs to the choreography rather than to one participant, phrase it from the perspective of the actor who observes it (`Then carol confirms the sign-offs arrived from "alice" then "bob"`).

## Name signals as domain events

Signals are part of the specification. Name them as facts of the domain — `signoff`, `message-sent`, `release-published` — not as implementation directives (`unblock-bob`, `continue`). A well-named signal makes the feature's synchronization points self-explanatory and turns the deadlock analyzer's messages into readable diagnostics.

## Polling belongs to assertions, not sleeps

There are no sleep steps in Kraken and none should be written. An assertion about an eventually-consistent UI takes the `polls: true` option and a `{duration}` budget in its text, making the tolerance explicit and visible in the feature:

```gherkin
And bob sees the message "hello from the Andes" on "message-cell" within 3s
```

## Durations are part of the contract

The `{duration}` parameter (`500ms`, `5s`, `2m`) appears wherever the specification tolerates waiting — signal waits, polled assertions, background-task joins. Choosing the budget in the feature, rather than burying a timeout in code, keeps the tolerance reviewable.
