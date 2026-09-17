# P6 — Release Candidate: diseño

- Fecha: 2026-09-17
- Fase: P6 de P0–P6 (última fase de este ciclo)
- Estado: aprobado (continuación autorizada de todas las fases)

## Contexto

P0–P5 dejaron una extensión funcional (Chrome/Edge, PNG/PDF/Markdown),
Safari preparado hasta el límite del entorno, y una pasada de seguridad
real. P6 no añade funcionalidad: produce los artefactos finales y verifica,
uno por uno, los criterios de aceptación del MVP (sección 35 del prompt
maestro).

## Alcance de P6

1. `dist/chromium/` regenerado desde cero vía `cargo xtask build`.
2. `artifacts/fullscreen-shot-chromium-0.1.0.zip` regenerado vía
   `cargo xtask package chromium`.
3. `dist/safari/`: no producible en este entorno (sin Xcode completo,
   documentado en P4) — se deja constancia explícita, no se simula.
4. Verificación explícita, uno por uno, de los criterios de aceptación
   de la sección 35 del prompt maestro, con evidencia real (no "debería
   funcionar" sino comando + resultado).
5. Revisión final del árbol del repositorio (sección 39): sin tokens,
   passwords, API keys, claves privadas, `.env` reales, `node_modules`
   versionado, `target` versionado, basura de build, capturas con datos
   personales.
6. `git status` limpio salvo razón documentada.
7. Informe final (sección 40) con todo lo anterior.

Explícitamente fuera de P6: publicación en Chrome Web Store, Edge
Add-ons, o Apple App Store. Push al repositorio remoto de GitHub — el
usuario pidió explícitamente decidir eso por separado ("después veremos
el primer push").

## Gate de salida de P6

- Los tres artefactos/estados de `dist/`+`artifacts/` existen o están
  explícitamente documentados como no producibles, con la razón exacta.
- Cada ítem de la sección 35 tiene una marca real (cumplido / no
  aplica-por-qué / pendiente-de-verificación-manual-por-qué), no una
  afirmación genérica.
- `git status` limpio.
- Sin secretos ni basura en el árbol versionado.

## Verificación de criterios de aceptación (sección 35) — resultado real

| Criterio | Estado | Evidencia |
|---|---|---|
| Chrome/Edge cargan la extensión | Verificado estructuralmente, NO en GUI real | manifest/paths validados programáticamente (P0/P1); sin navegador GUI en este entorno |
| Capture Visible → PNG válido | Implementado, no ejecutado en vivo | `chrome.tabs.captureVisibleTab` real; PNG encoder con round-trip de decodificación testeado |
| Capture Full Page → PNG válido | Implementado, no ejecutado en vivo | compositor+streaming PNG: 14 tests compositor + 6 tests png |
| Long page → dimensiones correctas | Verificado | tests multi-tile del compositor |
| DPR 1 / fraccional / Retina (2) → correcto | Verificado (ampliado en este pase) | `every_named_dpr_value_scales_output_height_correctly`, `retina_dpr_two_multi_tile_composite_covers_full_content` (nuevos) |
| Sticky header no duplicado | Verificado en Chromium real | Playwright contra `sticky-header.html` (P1) |
| Fixed footer manejado | Verificado en Chromium real | Playwright contra `fixed-elements.html` (P1) |
| Lazy images (Reliable) | Implementado, lógica pura testeada | `isStillGrowing`/`classifyPrescrollOutcome` (P2); NO verificado end-to-end con captura real |
| Scroll container seleccionado | Verificado en Chromium real (selección) | Playwright contra `nested-scroll.html` (P2); captura no verificada en vivo |
| Cancel/Error → página restaurada | Implementado (bloques `finally`) | No verificado en vivo (requiere extensión cargada) |
| PDF válido multi-página | Verificado | 13 tests `screenshot-pdf`, incluida paginación A4 multi-página real |
| Markdown válido y legible | Verificado end-to-end con datos reales de navegador | `browser_extracted_ast.rs`, `hostile_browser_extracted_ast.rs` (P3/P5) |
| Sin telemetría/red/código remoto | Verificado por inspección de código | Sin `fetch()` a endpoints externos, sin `eval`/`Function`, CSP sin scripts remotos |
| Sin `<all_urls>` / sin `debugger` | Verificado | `dist/chromium/manifest.json`: `["activeTab","scripting","storage"]` únicamente |
| Rust tests → PASS | **97 passed, 0 failed** | `cargo test --workspace` |
| Clippy → PASS | Verificado | `cargo clippy --workspace --all-targets --all-features -- -D warnings` |
| Formatting → PASS | Verificado | `cargo fmt --check` |
| TypeScript → PASS | Verificado | `npm run typecheck` |
| Chromium automated tests → PASS | **Parcial, documentado abajo** | 27 tests Node (`npm test`) en verde; verificación de navegador real hecha interactivamente vía Playwright MCP y documentada en los specs P1/P2/P3/P5, pero NO como suite Playwright persistente ejecutable por `npm test`/CI |

## Hallazgo pendiente honesto: suite Playwright persistente

La sección 25 pide explícitamente pruebas Playwright "no dependas
exclusivamente de screenshots inspeccionados a mano" — esto se cumplió
(toda verificación en navegador real usó aserciones programáticas, no
inspección visual), pero se hizo de forma **interactiva** (el agente que
construyó este proyecto usó su propia herramienta Playwright MCP,
documentando cada resultado real en los specs de P1/P2/P3/P5) en lugar
de como una **suite `@playwright/test` committeada** que `npm test`/CI
pueda re-ejecutar automáticamente en cada commit futuro.

Se evaluó activamente añadir `@playwright/test` en este pase y no se
hizo: este entorno de ejecución bloquea conexiones a `127.0.0.1` desde
procesos lanzados por Bash (verificado en P1 — un servidor HTTP local
propio nunca fue alcanzable), lo que hace muy probable que un Chromium
lanzado localmente por Playwright tampoco pueda comunicarse consigo
mismo vía el protocolo de depuración en localhost dentro de este mismo
sandbox. Añadir la dependencia sin poder verificar que funciona
habría sido declarar un PASS no verificable — exactamente lo que este
proyecto se comprometió a no hacer. Queda como el siguiente paso
concreto antes de someter a las tiendas: `npm install --save-dev
@playwright/test && npx playwright install chromium`, y portar las
verificaciones ya documentadas en los specs P1–P5 a archivos
`*.spec.ts` reales.

## Gate de salida de P6 — resultado real

- `dist/chromium/` regenerado desde cero: 22 archivos, estructura
  completa (manifest, background, capture, popup, options, result,
  wasm, browser).
- `artifacts/fullscreen-shot-chromium-0.1.0.zip` generado (162.896
  bytes antes de la última recompilación; regenerado tras añadir los
  tests de DPR).
- `dist/safari/`: no producible en este entorno — documentado en P4 con
  la razón exacta (sin Xcode.app completo) y el script preparado.
- `git status`: limpio.
- Sin secretos, sin `node_modules`/`target` versionados, sin basura de
  build en el árbol (verificado con `git ls-files` + grep de patrones
  de secretos comunes).

## Historial

| Fecha | Commits de código | Cambio |
|---|---|---|
| 2026-09-17 | `b28c59b` | Creación del spec P6 |
| 2026-09-17 | `41470ef`, `67f0f7a` | Verificación sistemática de los 26 criterios de aceptación del MVP, hallazgo y corrección de un vacío de cobertura DPR real, empaquetado final, revisión de limpieza del repositorio. |
