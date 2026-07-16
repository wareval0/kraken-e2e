> **Historical document — superseded by [ADR-0001](0001-general-architecture.md) (Accepted 2026-07-02). Do not treat as current.**
> This is the pre-ADR working draft, retained **verbatim in its original Spanish** as a declared exemption to the English-only rule (ADR-0001 constraint C12): translating a superseded historical source would alter the record ADR-0001's deviation ledger quotes from.

# Kraken 3.0 — Mapa Arquitectónico

**Universidad de los Andes — Software Design Lab**
**Documento de planeación para desarrollo asistido con Claude Code + Fable 5**
**Versión:** 0.1 (borrador de trabajo, base para ADR-0001 que generará Fable 5)

---

## 1. Contexto y diagnóstico

Kraken (v1.0 "KrakenMobile" y v2.0) es una herramienta open-source del Software Design Lab de Uniandes para pruebas E2E que requieren **intercomunicación entre usuarios/dispositivos** (dos apps que se coordinan durante el test: uno envía, otro verifica). Es su diferenciador real frente a Appium/WebdriverIO puros, que no tienen esa primitiva.

Problemas actuales identificados:

| Problema | Causa raíz |
|---|---|
| Dependencias rotas / sin mantenimiento | Ruby + Calabash (v1) descontinuado; stack v2 desactualizado (Appium 1/2, WDIO viejo) |
| Alcance corto | Solo Android + Web. No hay iOS. No hay desktop/TV. |
| Señalización frágil | v1/v2 implementan señalización a mano vía archivos/polling — es exactamente el tipo de problema que WebDriver ya resuelve con primitivas nativas hoy |
| Sin plan de continuidad | Sin ADRs, sin arquitectura de plugins, difícil de heredar entre generaciones de tesistas |
| Provisionamiento manual | Instalación multi-paso, dependiente de gemas Ruby + SDKs sin diagnóstico automatizado |

**Kraken 3.0 no es un fork — es una reescritura completa** sobre una arquitectura de núcleo + adaptadores (hexagonal), pensada para sobrevivir rotación de estudiantes y evolucionar por años.

---

## 2. Decisiones tecnológicas (estado del arte, verificado a julio 2026)

| Área | Decisión | Por qué (vanguardia + estabilidad) |
|---|---|---|
| Runtime | **Node.js 22 LTS**, TypeScript 5.x en modo `strict` | El ecosistema Appium/WebdriverIO es Node-nativo; no tiene sentido pelear contra eso. Bun/Deno quedan como línea de exploración futura para tooling interno (build, scripts), no como runtime de producción — el riesgo de compatibilidad con Appium/ADB/Xcode toolchains es demasiado alto para un proyecto institucional. |
| Motor de automatización móvil | **Appium 3** + `uiautomator2` (Android) + `xcuitest` driver (iOS) | Appium 3 es la versión estable actual; el driver XCUITest 10.x ya solo es compatible con Appium 3, así que no tiene sentido construir sobre Appium 2. **Restricción no negociable:** el driver iOS (XCUITest/WebDriverAgent) solo corre sobre macOS con Xcode — es una limitación de Apple, no nuestra. Kraken 3.0 debe asumir esto explícitamente en su arquitectura de CI (runners macOS) y en el `doctor` de provisionamiento. |
| Motor de automatización web + orquestación multi-sesión | **WebdriverIO v9+** como capa unificadora sobre Android/iOS/Web | Hallazgo clave: WDIO ya tiene **Multiremote**, una primitiva nativa diseñada exactamente para "features that require multiple users (chat, WebRTC)". Esto significa que la señalización de Kraken **no debe reinventarse a mano** — se construye *sobre* Multiremote + un bus de eventos propio, no reemplazándolo. Es una simplificación arquitectónica real, no cosmética. |
| DSL de pruebas (BDD) | **Gherkin rediseñado desde cero**, sin compromiso de compatibilidad con specs viejas, usando `@cucumber/cucumber` (última versión mantenida) + capa de *step definitions tipadas* en TypeScript | Se mantiene Gherkin porque es el punto fuerte de Kraken (legibilidad para no-programadores, historias de usuario ejecutables), pero el vocabulario de steps se rediseña completo: pasos de señalización más expresivos, autocompletado real vía tipos, generación de step definitions boilerplate. |
| Señalización multi-usuario/dispositivo | **Bus de eventos pub/sub desacoplado del transporte**: `EventEmitter` en memoria para ejecución local, adaptador WebSocket/Redis para ejecución distribuida (device farms, CI paralelo) | Reemplaza el mecanismo de archivos + polling de v1/v2, que es la causa típica de flakiness. Se expone como paquete independiente (`@kraken/signaling`) reutilizable fuera de Gherkin también. |
| CLI | **oclif** (framework usado por Salesforce CLI, Heroku CLI, Shopify CLI) + **Ink** (React para terminal) para UI rica en vivo | oclif da arquitectura de plugins nativa (`kraken plugins:install @kraken/driver-ios`), autogeneración de ayuda, y es el estándar de facto para CLIs profesionales de nivel empresarial. Ink es React — esto es estratégico: el código de UI de la terminal (componentes, estado, eventos) es reutilizable conceptualmente cuando se construya la GUI futura (Electron/Tauri con React), reduciendo curva de aprendizaje para quien continúe el proyecto. |
| Monorepo | **pnpm workspaces + Turborepo** | Instalaciones rápidas y determinísticas, caché de builds, y es el patrón estándar 2025-2026 para monorepos TS de este tamaño (más liviano que Nx, suficiente para esta escala). |
| Config | `kraken.config.ts` tipado (patrón `wdio.conf.ts` / `playwright.config.ts`) | Autocompletado, validación en tiempo de escritura, en vez de JSON plano. |
| Generación de datos | `@faker-js/faker` (continúa siendo el estándar) + capa de *fixtures* tipadas/validadas con `zod` | Mejora sobre el `$faker_id` de v2: ahora con schema validation, evita datos inconsistentes entre steps. |
| Fuzzing / "Kraken Monkey" | Reimaginado como motor de inyección de eventos aleatorios cross-platform (Android + iOS + Web), consciente del bus de señales | Hoy es un wrapper de ADB Monkey (solo Android). Se generaliza como capacidad del núcleo, no como parche por plataforma. |
| Reportería | **Allure 3** + reporter HTML propio + salida JSON para dashboards + vista en vivo por terminal (Ink) | Reportería accionable, no solo logs planos. |
| Lint/format | **Biome** (reemplaza ESLint + Prettier) | Más rápido, una sola herramienta, menos configuración que mantener entre tesistas. |
| Testing del propio Kraken | **Vitest** | Estándar actual para proyectos TS modernos, mucho más rápido que Jest. |
| Releases | **Changesets** (versionado independiente por paquete del monorepo) + publicación npm | Necesario porque hay múltiples paquetes (`core`, `driver-android`, `driver-ios`, `driver-web`, `cli`, `signaling`, `gherkin`, `data-gen`, `reporters`) con ciclos de vida propios. |
| Provisionamiento | `kraken doctor` (diagnóstico de entorno: SDK Android, Xcode, dispositivos conectados, versiones) + distribución vía npm + Homebrew + imagen Docker para CI (Android/Web; iOS no es dockerizable por restricción de Apple) | "Fácil aprovisionamiento" se resuelve con diagnóstico automatizado + múltiples canales de instalación, no con una sola bala de plata. |
| CI | **Fuera de alcance por ahora.** Todo el desarrollo y ejecución corre local, en una MacBook Pro M1 Pro. La arquitectura debe dejar la puerta abierta a CI (GitHub Actions con runner `macos-latest` para iOS) como fase futura, sin construirla ahora. | No hay org de GitHub institucional todavía; no tiene sentido invertir esfuerzo en pipelines que nadie va a correr. Sí importa que el diseño no *impida* añadir CI después (evitar hardcodear rutas o supuestos que solo funcionen en la máquina del desarrollador). |
| Detección de plataforma anfitriona | **Capacidad de primer nivel del núcleo**, no solo un chequeo de `kraken doctor`: en arranque, Kraken detecta SO + arquitectura del host (`darwin`/`arm64` vs otros) y **restringe en tiempo de ejecución** la disponibilidad del driver iOS — no solo lo diagnostica, lo bloquea con mensaje claro si alguien intenta correr un escenario iOS en un host no-Apple. | Viene de un requisito explícito: como el equipo de desarrollo trabaja sobre una MacBook M1 Pro (macOS + Apple Silicon), Kraken debe saber por sí mismo cuándo iOS es viable y cuándo no, en vez de fallar tarde con un error críptico de Xcode/WebDriverAgent. Esto también protege a futuros colaboradores que corran Kraken en Linux/Windows: deben ver "iOS no disponible en este host" de forma inmediata y explícita, no un stacktrace de Appium. |

---

## 3. Arquitectura: núcleo + adaptadores (hexagonal)

Principio rector: **el núcleo de Kraken no sabe qué es Appium, ADB o un navegador.** Solo conoce contratos (interfaces). Cada plataforma es un *driver plugin* que implementa esos contratos. Esto es lo que permite:

- Añadir plataformas nuevas (desktop, smart TV — WDIO ya soporta esto vía Appium) sin tocar el núcleo.
- Que la futura GUI consuma el mismo núcleo que la CLI, sin duplicar lógica.
- Que un tesista pueda trabajar en un driver sin entender todo el motor de orquestación.

```
┌─────────────────────────────────────────────────────────┐
│                      ADAPTADORES DE ENTRADA               │
│   CLI (oclif + Ink)        │   GUI futura (Tauri + React) │
└───────────────┬─────────────────────────┬─────────────────┘
                 │                         │
                 ▼                         ▼
┌─────────────────────────────────────────────────────────┐
│                      @kraken/core                          │
│  - Motor de orquestación de sesiones multi-dispositivo     │
│  - Parser/runner de escenarios (Gherkin tipado)             │
│  - Registro de plugins (drivers, reporters, steps)          │
│  - Emisor de eventos estructurados (testStart, stepEnd...)  │
│  - Contratos: DriverAdapter, SignalTransport, Reporter       │
└───────┬───────────────┬───────────────┬──────────┬─────────┘
        │               │               │          │
        ▼               ▼               ▼          ▼
┌──────────────┐ ┌──────────────┐ ┌───────────┐ ┌─────────────┐
│ driver-       │ │ driver-      │ │ driver-   │ │ (futuro)     │
│ android       │ │ ios           │ │ web       │ │ driver-      │
│ (Appium+      │ │ (Appium+     │ │ (WDIO     │ │ desktop/tv    │
│ uiautomator2) │ │ xcuitest,     │ │ nativo)   │ │              │
│               │ │ solo macOS)   │ │           │ │              │
└──────────────┘ └──────────────┘ └───────────┘ └─────────────┘

        Paquetes transversales (usados por todos los drivers):
        @kraken/signaling   → bus pub/sub multi-usuario/dispositivo
        @kraken/gherkin     → DSL BDD tipado + step registry
        @kraken/data-gen    → fixtures con faker + validación zod
        @kraken/fuzz        → motor de eventos aleatorios cross-platform
        @kraken/reporters   → Allure/HTML/JSON/terminal
        @kraken/config      → schema y loader de kraken.config.ts
        @kraken/doctor      → diagnóstico y provisionamiento de entorno
```

### Estructura del monorepo

```
kraken/
├── packages/
│   ├── core/
│   ├── cli/
│   ├── driver-android/
│   ├── driver-ios/
│   ├── driver-web/
│   ├── signaling/
│   ├── gherkin/
│   ├── data-gen/
│   ├── fuzz/
│   ├── reporters/
│   ├── config/
│   └── doctor/
├── apps/
│   └── docs/                # sitio de documentación (VitePress + TypeDoc)
├── examples/
│   └── multi-user-android-ios-web/   # escenario de referencia con 3 plataformas
├── adrs/                     # Architecture Decision Records
├── .github/workflows/        # CI, incluye matriz con macos-latest
├── turbo.json
├── pnpm-workspace.yaml
└── biome.json
```

---

## 4. Tabla de re-imaginación de features (v2 → v3)

| Feature en Kraken v2 | Rediseño en Kraken 3.0 |
|---|---|
| Señalización por archivos + polling | Bus pub/sub (`@kraken/signaling`), transporte local o distribuido, construido sobre Multiremote de WDIO |
| Kraken Monkey (wrapper de ADB Monkey, solo Android) | Motor de fuzzing cross-platform (Android/iOS/Web), consciente de señales |
| `$faker_id` en texto plano | Fixtures tipadas con `@faker-js/faker` + validación `zod` |
| `properties file` para credenciales | Gestión de secretos vía `.env` + integración opcional con keychain/vault |
| Distribución solo como gema Ruby / paquete npm | npm + Homebrew + Docker (Android/Web) + binario ejecutable (Node SEA) |
| Solo Android + Web | Android + iOS + Web con paridad desde v1, arquitectura abierta a Desktop/Smart TV |
| Sin diagnóstico de entorno | `kraken doctor` — valida SDKs, dispositivos, versiones de Xcode/Android antes de correr |
| Reportes básicos | Allure 3 + terminal en vivo (Ink) + JSON para dashboards CI |
| Sin arquitectura de plugins | Núcleo + drivers + steps como plugins instalables independientemente |

---

## 5. Roadmap por fases (horizonte multi-mes, con posibilidad de tesistas)

Dado que el equipo puede rotar, cada fase debe cerrar con **documentación y ADRs actualizados**, no solo código.

**Fase 0 — Fundaciones (semanas 1-3)**
Scaffolding del monorepo, `@kraken/core` (contratos + motor de eventos), CI base, `kraken doctor` mínimo, ADR-0001 (esta arquitectura, revisada/ajustada por Fable 5), documentación de contribución.

**Fase 1 — Motor + un driver end-to-end (semanas 4-8)**
`driver-android` completo, `@kraken/gherkin` con vocabulario nuevo, `@kraken/signaling` (transporte local), reporter básico. Meta: un escenario multi-dispositivo Android↔Android corriendo de punta a punta.

**Fase 2 — Paridad iOS + Web (semanas 9-14)**
`driver-ios` (requiere runner macOS en CI), `driver-web`, escenario de referencia con las tres plataformas mezcladas en un mismo `.feature`.

**Fase 3 — Robustez institucional (semanas 15-20)**
`@kraken/fuzz`, `@kraken/data-gen`, reportería Allure completa, transporte distribuido de señalización (Redis/WebSocket) para device farms/CI paralelo, publicación en npm con Changesets, sitio de documentación.

**Fase 4 — Preparación para GUI (más adelante, no en el alcance inmediato)**
Exponer `kraken serve` (servidor local con API/WebSocket sobre eventos del core) para que una futura GUI (Tauri + React) se conecte sin tocar el núcleo.

---

## 6. Entorno de desarrollo actual

Todo el desarrollo, ejecución y pruebas de Kraken 3.0 corren, por ahora, sobre **una única MacBook Pro M1 Pro** (macOS, Apple Silicon), sin repositorio en una org de GitHub institucional todavía y sin CI. Esto tiene dos implicaciones de diseño directas:

1. **Ventaja real**: al ser macOS + Apple Silicon, la máquina de desarrollo *sí* puede correr el driver iOS (Xcode/XCUITest) además de Android (emuladores arm64) y Web — o sea, en esta fase se puede desarrollar y probar las tres plataformas localmente sin depender de device farms ni de CI en la nube.
2. **Restricción a diseñar explícitamente**: dado que hoy todo corre en un host que *sí* soporta iOS, es fácil que el código termine asumiendo implícitamente "estoy en macOS" en todas partes. Hay que evitar eso desde el principio: la detección de host (SO + arquitectura) debe ser explícita y el driver iOS debe quedar deshabilitado con un mensaje claro — no con un fallo silencioso ni un crash de Appium — en cualquier host que no sea macOS. Esto no es solo corrección técnica: es lo que permite que, más adelante, alguien en Linux/Windows pueda clonar el repo y correr Android/Web sin fricción, mientras iOS se documenta como "requiere macOS" de forma explícita y temprana en la experiencia (`kraken doctor`, mensajes de CLI, README).

CI (GitHub Actions con runner `macos-latest`) queda como ítem de roadmap futuro, no como trabajo de esta fase — pero el diseño no debe asumir rutas, credenciales o configuración que solo funcionen en la máquina local del desarrollador, precisamente para no tener que rehacer esa parte cuando llegue el momento.

## 7. Riesgos a vigilar

- **Todo corre en una sola máquina hoy.** Sin backups de configuración ni CI, un problema local (SDK corrupto, Xcode roto) puede parar el desarrollo. Vale la pena documentar el setup de esa máquina (`kraken doctor` debería poder regenerar ese diagnóstico) para no depender de memoria tribal.
- **Rotación de tesistas**: sin ADRs y sin pruebas del propio Kraken, el proyecto puede degradar igual que v1/v2. Es una prioridad no negociable, no un "nice to have".
- **Multiremote de WDIO no es una solución completa por sí sola** — resuelve la sesión concurrente, pero la semántica de "esperar señal X" sigue siendo responsabilidad de `@kraken/signaling`. No asumir que WDIO regala esa parte gratis.
- **Desarrollar iOS y Android/Web en el mismo host puede ocultar bugs de detección de plataforma** — conviene probar deliberadamente el comportamiento "host no-Apple" (por ejemplo, con una VM Linux o simplemente mockeando la detección en tests unitarios) para no descubrir en producción que el guard de iOS nunca se ejerció de verdad.
