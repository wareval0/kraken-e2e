---
layout: home
hero:
  name: Kraken
  text: Multi-user, multi-device end-to-end testing
  tagline: Android, iOS and Web — several real users, one scenario, deterministic synchronization.
  actions:
    - theme: brand
      text: What is Kraken?
      link: /introduction/what-is-kraken
    - theme: alt
      text: Getting started
      link: /getting-started/installation
    - theme: alt
      text: API reference
      link: /api/
features:
  - title: Signal-synchronized choreography
    details: Actors on different devices coordinate through an append-only signal log with replay-first delivery and per-subscriber FIFO ordering. Signal misuse is detected statically, before any device boots.
  - title: One contract, three platforms
    details: A single session interface and portable locator strategies drive Android, iOS and Web. Platform parity is verified by a conformance kit against real devices, not assumed.
  - title: Reproducible by construction
    details: Seeded data generation, seed-derived monkey testing and lockfile-pinned drivers make every run repeatable across machines and time.
  - title: Engineering-grade tooling
    details: Environment diagnosis, device discovery, live terminal UI, Allure and CTRF reporting, and an HTTP/WebSocket projection of every run.
---

## See it run

A live Kahoot quiz played across a desktop browser and the native Android app,
in one scenario — the clearest picture of what Kraken does. Read the
walkthrough in [Live Kahoot, across two devices](/examples/kahoot).

<!--
  MEDIA PLACEHOLDER — landing hero video.
  Embed a short, muted screen recording of the cross-device Kahoot run
  (host browser + phone). Place the file at apps/docs/public/media/hero.mp4
  and uncomment:

  <video controls muted playsinline width="100%" poster="/media/hero-poster.png">
    <source src="/media/hero.mp4" type="video/mp4" />
  </video>
-->

## Built at the Software Design Lab

Kraken is developed at the [Software Design Lab](https://thesoftwaredesignlab.github.io/)
of the School of Engineering, Universidad de los Andes. It is the third
generation of the group's cross-device testing tooling, succeeding the earlier
Ruby and Node lineages with a ground-up TypeScript rewrite.

<!--
  MEDIA PLACEHOLDER — institutional identity.
  Add the Universidad de los Andes and Software Design Lab logos (and, if
  desired, a photo of the group or lab). Place assets under
  apps/docs/public/media/ and reference them here, e.g.:

  <p>
    <img src="/media/uniandes.svg" alt="Universidad de los Andes" height="48" />
    <img src="/media/sdl.svg" alt="Software Design Lab" height="48" />
  </p>
-->

### Author

**Wilmer Arévalo-González** — Research Projects Professional, School of
Engineering, Universidad de los Andes · [w.arevalo@uniandes.edu.co](mailto:w.arevalo@uniandes.edu.co)

Released under the GNU General Public License v3.0.
