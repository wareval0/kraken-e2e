# What is Kraken?

Kraken is an open-source tool for end-to-end testing of scenarios that involve **more than one user, each on their own device or platform, interacting with each other**. It was created by the [Software Design Lab](https://thesoftwaredesignlab.github.io/) at Universidad de los Andes, and version 3.0 is a ground-up TypeScript rewrite of the tool published in the research literature as Kraken and Kraken-Mobile.

## The problem

Modern applications are rarely single-user systems. A chat message is sent by one person and received by another. A ride is requested by a passenger and accepted by a driver. A document is edited by one collaborator while a second one watches the change appear. These *inter-user* flows are where integration defects concentrate — and they are precisely the flows that conventional end-to-end tools cannot express, because a WebDriver or Appium session models exactly one user on exactly one device.

The common workarounds are unsatisfying: testing each side in isolation against mocks (which removes the integration under test), or stitching independent test processes together with shared files and sleeps (which produces flaky, unmaintainable suites).

## The approach

Kraken makes the multi-user scenario a first-class artifact. A single Gherkin feature declares a cast of **actors**, each bound to a platform — an Android device, an iOS simulator, a web browser. Steps are addressed to actors by name and execute in the order they are written. When one actor's progress depends on another's, the dependency is expressed explicitly with a **signal**: one actor publishes a named event (optionally carrying data) and another waits for it. The signal log is append-only with replay-first delivery, so the classic lost-wakeup race of ad-hoc synchronization cannot occur.

```gherkin
Scenario: a message composed on Android arrives on iOS
  When alice writes "hello from the Andes"
  And alice taps send
  Then bob waits for the signal "message-sent" within 5s
  And bob sees the message "hello from the Andes" within 3s
```

Every actor exposes the same session interface regardless of platform, and locators are expressed through portable strategies that resolve to the native concept on each platform. The same step definition can therefore drive an Android emulator, an iOS simulator or a browser — which platform an actor uses is purely a configuration decision.

## What Kraken is not

Kraken is not a load-testing tool, and it is not a thin convenience wrapper over Appium or WebdriverIO for single-user automation — although it works perfectly well with a single actor. If a suite never involves two users interacting, a plain WebDriver stack is a simpler choice. Kraken's reason to exist is the choreography.

## Provenance

Kraken 3.0 succeeds two earlier generations: Kraken-Mobile (Ruby/Calabash, ICSME 2019) and Kraken 2 (Node/Cucumber, Science of Computer Programming 2023). Version 3.0 shares their goal and their research lineage but no code and no scenario compatibility: the signaling model, the execution model, the driver architecture and the tooling are new. It is released under the GNU General Public License v3.0, and every architectural decision is recorded as an ADR in the repository.
