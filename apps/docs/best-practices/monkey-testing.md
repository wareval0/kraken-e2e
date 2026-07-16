# Monkey testing

`@kraken-e2e/fuzz` is a seeded random-event engine over the same session contract that scripted steps use — one monkey definition runs on Android, iOS or Web. Its distinguishing property is reproducibility: the walk is a pure function of the seed, so any failure can be replayed exactly, on any machine.

## Plan and run

```typescript
import { planFuzz, runFuzz } from '@kraken-e2e/fuzz';

const result = await runFuzz({
  session: actor.session,          // any UserSession
  surface: {
    tappable: [{ by: 'a11y', value: 'button-Active' }],
    typable:  [{ by: 'a11y', value: 'text-input' }],
    scrollable: [],                // optional pool
  },
  steps: 25,                       // the action budget
  seed: 20260709,                  // REQUIRED — the reproducibility contract
  weights: { tap: 5, typeText: 3, scrollIntoView: 1, pressKey: 0 },
  tolerateActionErrors: 25,        // record misses, keep walking (see below)
});
```

- `planFuzz(options)` derives the full action sequence from the seed **without a session** — pure, instant, unit-testable. `runFuzz` executes that plan.
- The **surface** declares which elements the monkey may touch, per interaction kind. Kinds with an empty pool are never planned; `pressKey` draws from the semantic key set and needs no pool.
- **Weights** bias the walk. A weight of `0` removes a kind entirely.
- `result` carries the executed `trace`, tolerated `errors`, a `status` (`completed | failed | aborted`) and, on failure, the failing entry with a screenshot path. `replayTrace(session, trace)` re-executes a captured trace verbatim.

## Tolerating real interfaces

Real UIs flake under a monkey in ways that are not application defects: a soft keyboard raised by a previous `typeText` occludes lower elements; a framework re-render invalidates an element handle mid-action; a tapped control opens a modal dialog. `tolerateActionErrors: n` lets the walk absorb up to *n* failed actions — each miss is recorded in `result.errors` with its message, and the walk continues. Reproducibility is unaffected: the *plan* derives from the seed alone and never depends on runtime outcomes.

Strict mode (the default, tolerance 0) remains right for surfaces that must never reject an interaction.

## Monkey runs as scenarios

Because the engine drives the ordinary session, a monkey run is just another BDD step — with the seed fixed, it is as deterministic as any scripted scenario:

```gherkin
Scenario: the forms screen survives a seeded monkey and the walk is reproducible
  When alice unleashes 25 seeded random interactions on the forms screen
  Then alice confirms the forms screen survived the monkey
  And alice confirms the monkey walk is reproducible from its seed
```

Two practices make the survival assertion honest:

1. **Recover before asserting.** A monkey legitimately triggers native dialogs; dismiss any leftovers (a bounded loop tapping the dialog's confirmation) before checking that the screen is alive.
2. **Assert reproducibility explicitly.** Re-derive the plan from `result.seed` and compare lengths/content against what ran — the suite then guards its own determinism.

## Field notes

Three hazards observed on real applications, worth designing surfaces around:

- Toggling a React Native switch re-renders the component tree and invalidates in-flight element handles.
- After any `typeText`, the soft keyboard occludes the lower half of the screen until dismissed.
- Controls that open modal dialogs block navigation until the dialog is handled — include their dismissal in recovery, or exclude them from the surface when determinism matters more than coverage.
