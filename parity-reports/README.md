# Platform parity

The common session surface (`UserSession`) must behave identically on Android
and iOS. Parity is a generated artifact, not a claim: the Conformance Test Kit
runs every core operation against a real device and emits one
`parity-report.<platform>.json` per driver.

The committed reports certify the pass criterion — **zero `failing` entries on
either platform, and an empty diff between the two supported-operation sets** —
for all core operations against the pinned native-demo-app fixture (Android API
36 emulator, iOS 18.6 simulator). Symmetric `unsupported(reason)` entries are
permitted; an asymmetric one is a regression.

The criterion is machine-checked in `pnpm check`
(`packages/core/tests/parity-gate.test.ts`), so regenerating a report with a
regression fails the build. Reports are point-in-time artifacts of the machine
that produced them; regenerate with `KRAKEN_DEVICE_TESTS=1` (see the driver
packages' integration tests).
