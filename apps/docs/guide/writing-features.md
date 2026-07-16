# Writing features

Kraken scenarios are written in standard Gherkin. Feature files are parsed with the official Gherkin parser (`@cucumber/gherkin`), so the standard grammar applies unchanged: any editor, formatter or tooling that understands Gherkin understands a Kraken feature file. What Kraken adds is a discipline on top of the grammar — every step is addressed to exactly one actor, steps execute in written order, and the whole file is statically analyzed before any device session boots.

This page covers the feature-file side of the DSL. The code side — defining the steps that feature files call — is covered in [Writing steps](/guide/writing-steps).

## Features and scenarios

A feature file contains one `Feature` with one or more scenarios. A scenario is a *choreography*: a single script in which several actors participate.

```gherkin
Feature: Direct messaging
  Two users exchange a message across devices.

  Scenario: the message arrives
    When alice sends the message "hola"
    Then bob waits for the signal "message-sent" within 10s
    And bob sees the message "hola"
```

Two properties of step matching follow from the compilation model:

- **Keywords are documentation.** The compiler matches a step by its **text** against a single pool of definitions; the leading keyword (`Given`, `When`, `Then`, `And`, `But`, `*`) is not part of the match. Choose keywords for readability — see [Given/When/Then discipline](/best-practices/given-when-then).
- **Arguments travel in the step text.** All arguments reach a step handler through expression parameters such as `{string}` or `{duration}`. Doc strings and data tables attached to a step are not passed to handlers.

## The screenplay: steps execute in text order

A scenario compiles to a chain in which every step depends on the previous one. Steps therefore execute **one at a time, in exactly the order they appear in the file**, regardless of which actor each step is addressed to. Switching actors between consecutive lines does not introduce concurrency — it hands the single cursor of the screenplay to another device.

Concurrency exists only through two explicit escape hatches:

- **Background tasks** — a step whose definition is registered with `detached: true` starts work that runs alongside the rest of the screenplay and is joined later by an explicit built-in step. See [Background tasks](#background-tasks) below.
- **Signals** — the cross-device synchronization primitive. See [Signals](/guide/signals).

The conceptual model is introduced in [How Kraken works](/introduction/how-kraken-works).

## Actors and the closed cast

Every step is addressed to **exactly one actor**, named by the `{actor}` parameter in the step's expression. A step definition without an `{actor}` parameter cannot be registered at all — registration fails with `KRK-STEP-UNKNOWN-ACTOR` (see [Writing steps](/guide/writing-steps#defining-a-step)). There is no such thing as an actor-less step.

The `{actor}` parameter accepts two forms:

| Form | Pattern | Example |
|---|---|---|
| Bare name | `[a-zA-Z][a-zA-Z0-9_-]*` — a letter followed by letters, digits, `_` or `-` | `alice`, `player_2`, `qa-lead` |
| Quoted alias | `"[^"]+"` — any text in double quotes | `"the moderator"` |

Quoted aliases arrive with the quotes stripped: a step addressed to `"the moderator"` resolves to the actor id `the moderator`. Use the quoted form whenever the name contains spaces or does not start with a letter.

When a definition contains more than one `{actor}` parameter, the **first** one is the addressee; subsequent `{actor}` parameters arrive at the handler as ordinary string arguments. The built-in step `{actor} waits for the signal {string} from {actor} within {duration}` uses this: the first actor waits, the second is the required publisher.

### The closed cast rule

The cast is declared once, in the `actors` map of `kraken.config.ts` (see [Configuration](/guide/configuration)). The set is *closed*: a step that names any other actor is a compile error, reported before any session boots:

```
✗ [UNKNOWN_ACTOR] features/chat.feature › ghost actor: Step "alicia sends the
message \"hola\"" is addressed to undeclared actor "alicia". Did you mean
"alice"? Declared actors: alice, bob.
```

The *did-you-mean* suggestion appears when a declared actor is within Levenshtein edit distance 2 of the misspelled name.

Sessions boot only for actors a scenario actually references. An actor that is declared in the configuration but never addressed in a given scenario does not get a device session for that scenario.

## Parameter types

Step expressions are [Cucumber Expressions](https://github.com/cucumber/cucumber-expressions). Kraken registers two parameter types of its own on top of the standard set:

| Type | Matches | The handler receives |
|---|---|---|
| `{actor}` | A bare name (`alice`) or a quoted alias (`"the moderator"`) | The first occurrence is the addressee and is *not* passed as an argument; later occurrences arrive as the unquoted name (`string`) |
| `{string}` | Double- or single-quoted text: `"hola"`, `'hola'` | The text without quotes (`string`) |
| `{int}` | An integer literal: `3`, `42` | A `number` |
| `{duration}` | `\d+(?:\.\d+)?(?:ms|s|m)` — a number, optionally decimal, with unit `ms`, `s` or `m` | The value converted to **milliseconds** (`number`) |

`{duration}` semantics in full:

- `500ms` → 500, `10s` → 10 000, `2m` → 120 000, `1.5s` → 1 500.
- The value must be strictly positive. `0s` is rejected at compilation with `Duration "0s" must be positive.`; text that does not fit the pattern is rejected with `Invalid duration "…" — use e.g. "500ms", "10s", "2m".`
- There is **no default timeout anywhere** in the DSL. Every wait and every join carries an explicit `{duration}` — an intentional policy, not an omission.

Because matching is performed by the standard Cucumber Expressions engine, its remaining built-in parameter types (`{float}`, `{word}`, the anonymous `{}`, and the numeric family) are also available. Projects can add their own types with `defineParameterType` — see [Custom parameter types](/guide/writing-steps#custom-parameter-types).

## Built-in steps

Kraken ships a deliberately minimal built-in vocabulary: the choreography primitives only. App-domain steps (tapping buttons, sending messages) always belong to the project's own step files.

| Expression | Purpose |
|---|---|
| `{actor} waits for the signal {string} within {duration}` | Block the screenplay until the named signal is delivered to this actor |
| `{actor} waits for the signal {string} from {actor} within {duration}` | Same, but only accept records published by the second actor |
| `{actor}'s background task {string} completes within {duration}` | Join a background task started earlier in the scenario |

```gherkin
Scenario: coordinated hand-off
  When alice sends the message "hola"
  Then bob waits for the signal "message-sent" within 10s
  Then bob waits for the signal "typing" from alice within 5s
```

Signal-wait semantics come from the signal log: delivery is replay-first (a signal published before the wait began is never lost) and per-subscriber FIFO. The full model is described in [Signals](/guide/signals). The join step is executed by the scheduler itself, not by a user handler: the scenario blocks until the named task settles, and a task that failed in the background surfaces its error at the join step.

::: tip
A signal-wait step only compiles if some earlier step *declares* that it publishes the awaited signal, via the `publishes` option on its definition. See [Dry-run compilation](#dry-run-compilation) below and [the `publishes` option](/guide/writing-steps#publishes).
:::

## Background tasks

A step whose definition is registered with `detached: true` (see [Writing steps](/guide/writing-steps#detached)) does not block the screenplay. It passes as soon as its work *starts*; the work continues concurrently with the following steps and is joined later with the built-in join step:

```gherkin
Scenario: upload while chatting
  When alice starts uploading "demo.mp4" as "upload"
  Then bob sees the message "x"
  Then alice's background task "upload" completes within 2m
```

Rules, all enforced at compile time:

- The task **handle** is the last `{string}` argument of the detached step (`"upload"` above). A trailing `{duration}` or `{int}` never shadows it. A detached step with no string argument at all is a compile error.
- Handles are unique within a scenario; reusing one is a compile error.
- A join must be preceded by the detach that started the handle; joining an unknown handle is a compile error.
- **Every detached task must be joined** before the scenario ends. An unjoined handle is a compile error (leak detection).

## Background and Scenario Outline

Both standard structuring constructs are supported with standard pickle semantics:

- **`Background`** steps are prepended to every scenario in the feature.
- **`Scenario Outline` with `Examples`** expands into one independent scenario per table row. Placeholders are substituted into the step text *before* matching, so `"<what>"` matches a `{string}` parameter as usual:

```gherkin
Scenario Outline: send <what>
  When alice sends the message "<what>"
  Then bob sees the message "<what>"
  Examples:
    | what  |
    | hola  |
    | salut |
```

Each expanded row compiles, is statically analyzed, executes and reports as its own scenario. Scenario ids take the form `<feature-uri>#<n>`, where `n` is the scenario's position within the file — the outline above yields `chat.feature#1` and `chat.feature#2`. Signals are scoped per scenario *instance*, so Examples rows never see each other's signals.

## Tags

Tags are standard Gherkin: they may sit on a `Feature`, a `Scenario`, a `Scenario Outline` or an `Examples` table, and scenarios inherit the tags of their feature.

`kraken run --tags` filters scenarios with a [Cucumber tag expression](https://github.com/cucumber/tag-expressions) — `and`, `or`, `not` and parentheses over tag names:

```bash
kraken run --tags "@smoke"
kraken run --tags "@smoke and not @wip"
kraken run --tags "(@android or @ios) and not @flaky"
```

::: warning
A scenario excluded by the tag filter is skipped before compilation: it is neither executed nor statically analyzed. Run the suite without a filter (or with `--dry-run`) to validate everything.
:::

## Dry-run compilation

Compilation and static analysis **always** run first: `kraken run` refuses to boot any session while an error diagnostic exists. `--dry-run` stops after this pass, making it a fast, device-free validation of the whole suite:

```bash
kraken run --dry-run
kraken run --dry-run --tags "@smoke"
```

The pass validates, with no sessions booted:

1. **Gherkin syntax** — parse failures are reported per file.
2. **Step matching** — a step no definition matches is an error, and the diagnostic suggests the closest registered expression (by edit distance) along with the number of registered definitions:

   ```
   ✗ [STEP_UNMATCHED] features/chat.feature › close but wrong: No step
   definition matches "alice sends the mesage \"hola\"". Closest expression:
   "{actor} sends the message {string}". 12 definitions are registered.
   ```

3. **Ambiguity** — a step text that matches more than one definition is an error naming every matching expression.
4. **The closed cast** — steps addressed to undeclared actors, with a *did-you-mean* suggestion.
5. **Deadlock detection** — under the screenplay's total order, a signal wait that no *earlier* step or background task declares satisfying (via the `publishes` option) can never complete. It is rejected statically:

   ```gherkin
   Scenario: too late            # compile error: DEADLOCK
     Then bob waits for the signal "message-sent" within 10s
     When alice sends the message "hola"
   ```

   Reordering the two steps compiles: the producer now precedes the wait. Declarations resolved from step text (`publishes: ['$1']`) participate in the analysis with their concrete values.
6. **Background-task hygiene** — unjoined tasks, joins without a preceding detach, duplicate handles, and detached steps lacking a string handle.
7. **Durations** — non-positive values are rejected.

### Diagnostics

| Code | Meaning |
|---|---|
| `PARSE_ERROR` | The file is not valid Gherkin |
| `STEP_UNMATCHED` | No registered definition matches the step text |
| `STEP_AMBIGUOUS` | More than one definition matches the step text |
| `UNKNOWN_ACTOR` | The step is addressed to an actor outside the closed cast |
| `DEADLOCK` | A signal wait has no earlier declared producer |
| `UNJOINED_TASK` | A background task is started but never joined |
| `UNKNOWN_TASK` | A join names a task no earlier step started, a handle is duplicated, or a detached step has no string handle |

Each diagnostic is printed as `✗ [CODE] <file> › <scenario>: <message>` (warnings use `!`). A scenario with errors never yields an executable plan, but healthy scenarios in the same file still compile — the run simply refuses to start while any error exists:

```
Compilation failed — nothing was executed (no sessions were booted).
```

On success, `--dry-run` prints a summary and exits `0`:

```
Dry run OK: 2 scenario(s), 7 step(s), actors: alice, bob.
```

The exit code is `1` when any error diagnostic exists. All `kraken run` flags are listed in the [CLI reference](/reference/cli).
