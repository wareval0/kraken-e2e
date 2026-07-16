# Architecture Decision Records

> **npm scope note (2026-07-06):** the packages publish under the `@kraken-e2e/*`
> scope (the `@kraken` npm organization was not usable — institutional access).
> ADR texts predating this keep the original `@kraken/*` names; read them as
> `@kraken-e2e/*`. Package roles and boundaries are unchanged.

Every non-trivial design decision in Kraken 3.0 is recorded here. This is not bureaucracy: the previous Kraken versions died when their design context left with the students who held it. An ADR is the difference between a project a new thesis student can resume in a semester and one that gets rewritten from scratch in 2027.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-general-architecture.md) | General architecture | **Accepted** (2026-07-02) |
| [0002](0002-core-contracts.md) | Core contracts & session surface | **Accepted** (2026-07-03) |
| [0003](0003-signaling.md) | Signaling semantics & transports | **Accepted** (2026-07-03) |
| [0004](0004-dsl.md) | DSL vocabulary & step API | **Accepted** (2026-07-03) |
| [0005](0005-plugins-cli.md) | Driver plugin / CLI architecture | **Accepted** (2026-07-04) |
| [0006](0006-reporting-events.md) | Reporting & event schema | **Accepted** (2026-07-05) |
| [0007](0007-android-driver.md) | Android driver internals | **Accepted** (2026-07-04) |
| [0008](0008-ios-driver.md) | iOS driver internals | **Accepted** (2026-07-04) |
| [0009](0009-web-driver.md) | Web driver internals | **Accepted** (2026-07-05) |
| [0010](0010-serve-projection.md) | kraken serve projection surface | **Accepted** (2026-07-05) |

`context.md` is the pre-ADR working draft that ADR-0001 superseded; it is kept as historical input and must not be treated as current. It remains verbatim in its original Spanish as a declared C12 exemption (see its header banner) — historical sources are preserved, not translated.

## Writing an ADR

Copy `template.md` to `NNNN-short-title.md` (next number, English, kebab-case). Statuses: `Proposed` → `Accepted` / `Rejected`; later `Superseded by ADR-NNNN` if replaced. Decisions that touch the non-negotiable constraints (ADR-0001 §2) additionally require explicit human ratification, recorded in the ADR itself.

Two disciplines that keep ADRs honest:

- **Verify, don't recall**: any ecosystem claim (versions, maintenance status) is checked against the live ecosystem and date-stamped.
- **Declare deviations**: an ADR that changes an earlier decision says so in a deviation table — never silently.
