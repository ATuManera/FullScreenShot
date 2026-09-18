# P1 — Chrome/Edge Capture Visible + Capture Full Page → PNG: diseño

- Fecha: 2026-09-17
- Fase: P1 de P0–P6
- Estado: aprobado 

## Contexto

P0 dejó un workspace que compila con lógica de geometría/tiling/PNG/validación
testeada, y un shell MV3 que carga (estructuralmente verificado) pero sin
ninguna acción de captura real. P1 conecta ambos lados: implementa la
extracción real del PNG de página completa en Chrome/Edge.

## Alcance de P1

1. **Rate limiter real** (`screenshot-core::rate_limiter`): lógica pura de
   espaciado de llamadas a `captureVisibleTab()` (≈550ms, con backoff
   adaptativo ante error), testeada en Rust, expuesta vía WASM.
2. **Streaming compositor real** (`screenshot-core::compositor`): dado un
   `CapturePlan` (de P0) y un conjunto de tiles (buffers RGBA con su offset),
   compone la imagen final fila por fila sin mantener el bitmap completo +
   todos los tiles decodificados simultáneamente. Bandas no solapadas por
   tile (usa el plan de offsets con overlap ya definido en P0 solo como
   margen de tolerancia a redondeo, no para blending).
3. **WASM bridge ampliado**: `compose_full_page_png(...)` (compón + codifica
   PNG en un solo paso) y `rate_limiter_next_delay_ms(...)`.
4. **Extensión — capa `capture/` (TypeScript, sin chrome.\* donde sea posible)**:
   - `geometry.ts`: mide `scrollHeight`, viewport, `devicePixelRatio` del
     documento — funciones puras testeables con Playwright contra los
     fixtures de P0.
   - `sticky.ts`: detecta elementos `position: fixed` / `sticky`, los oculta
     reversiblemente para todos los tiles salvo el primero, y los restaura
     — funciones puras testeables con Playwright.
   - `orchestrator.ts`: el flujo real de captura (scroll → esperar
     estabilidad → `captureVisibleTab` vía mensaje al background → decodificar
     PNG a RGBA → enviar tile a WASM). Usa `chrome.*`, por lo que **no** es
     testeable con Playwright fuera de una extensión cargada.
   - `state.ts`: snapshot/restauración transaccional (scrollX/Y, overflow,
     scroll-behavior) — begin/capture/commit o begin/capture/rollback, según
     sección 10 del prompt maestro.
5. **Background/popup wiring**: mensajes `CAPTURE_VISIBLE`, `CAPTURE_FULL_PAGE`,
   `CANCEL_CAPTURE`; popup con progreso (`Preparing… / Capturing N/M… /
   Processing… / Exporting… / Done`) y botón `Cancel`.
6. **Detección de páginas no capturables** (`chrome://`, `edge://`, Chrome Web
   Store, etc.) con mensaje claro, sin fingir éxito.
7. **PNG** como único formato de salida en P1 (PDF/Markdown son P3).

Explícitamente fuera de P1:

- Selected Scroll Area, lazy loading Fast/Reliable — P2.
- PDF, Markdown — P3.
- Safari — P4.
- `cargo audit`/`cargo deny` — P5.

## Estrategia de fixed/sticky (decisión de diseño)

Un elemento `position: fixed` no tiene una "posición de contenido" única —
está anclado al viewport, no al scroll. La estrategia (reversible, documentada
en sección 14 del prompt maestro): antes de capturar el tile 2..N, ocultar
temporalmente (vía un atributo de datos + `visibility:hidden`, nunca remover
del DOM) los elementos fixed/sticky detectados; restaurar su visibilidad
inmediatamente después de cada captura. El primer tile se captura con los
elementos visibles, de forma que la salida final los conserva una sola vez,
en su posición natural (arriba de la página).

## Estrategia de stitching (decisión de diseño)

Reutiliza `CapturePlan`/`Tile` de P0: cada tile tiene un `scroll_offset.y`.
El compositor asigna a cada tile una banda de filas de salida
`[offset_i, offset_{i+1})` (el último tile cubre hasta `content_height`), sin
solapamiento en la imagen final — el overlap del plan de P0 es solo margen
de tolerancia para que capturas con timing/redondeo ligeramente distintos
igual cubran el contenido completo, no una zona de blending. Esto evita
costuras visibles sin necesitar comparación de píxeles entre tiles
adyacentes.

## Verificación (dado el entorno de ejecución)

Este entorno no tiene una ventana de Chrome/Edge con GUI disponible, así que
`chrome.*` (captureVisibleTab, scripting, tabs) no se puede probar
end-to-end aquí. Lo que sí se verifica automáticamente:

- Toda la lógica Rust (rate limiter, compositor, PNG) con tests
  unitarios/property-based.
- Las funciones puras de `capture/geometry.ts` y `capture/sticky.ts` contra
  los fixtures reales de `tests/pages/` usando Playwright (navegando a la
  página, inyectando y ejecutando la función, verificando el resultado) —
  esto no requiere que la extensión esté cargada.
- El orchestrator/background/popup se implementan correctamente según la
  arquitectura pero su verificación E2E completa queda como paso manual
  documentado, igual que en el gate de P0.

## Gate de salida de P1

- `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`,
  `cargo build --workspace`, build WASM — todos en verde.
- `npm run typecheck` en verde.
- Tests Playwright de `geometry.ts`/`sticky.ts` contra `long-page.html`,
  `sticky-header.html`, `fixed-elements.html`, `fractional-dpr.html` — en
  verde.
- Tests Rust del compositor cubren: página que cabe en un tile, página larga
  multi-tile, DPR 1/1.25/1.5/1.75/2, tiles duplicados/faltantes rechazados
  (reutilizando `validate_plan` de P0).
- `dist/chromium/` regenerado y validado estructuralmente (como en P0).

## Evidencia de verificación real (Playwright, navegador Chromium real)

Ejecutado contra el código compilado real (`dist/chromium/capture/*.js`),
cargado vía `data:` URL con el byte-a-byte de los fixtures reales (no se
pudo usar un servidor local ni `file://` por restricciones de red/sandboxing
del entorno de este agente — ver nota en el gate):

- `sticky-header.html`: `findFixedAndStickyElements` detectó `#sticky-header`;
  `hideElements` lo puso `visibility: hidden` sin removerlo del DOM
  (`domStillContainsElements: true`); `restoreElements` lo devolvió a
  `visibility: visible` y removió el atributo marcador.
- `fixed-elements.html`: detectó correctamente `#fixed-header` y
  `#fixed-footer` (dos elementos `position: fixed`).
- `long-page.html`: `measurePage` devolvió `scrollHeight: 8088` (10
  secciones × 800px + encabezado + bordes — consistente con el markup
  real) y `viewportWidth/viewportHeight` reales del viewport de Chromium.

## Gate de salida de P1

- `cargo fmt --check`, `cargo clippy --workspace --all-targets --all-features -- -D warnings`,
  `cargo test --workspace` (60 passed, 0 failed), `cargo build --workspace`,
  build WASM (`wasm32-unknown-unknown` + `wasm-pack build --target web`) —
  todos en verde.
- `npm run typecheck` en verde (incluye `orchestrator.ts`, `background/`,
  `result/`, `popup.ts`).
- Verificación Playwright de `geometry.ts`/`sticky.ts` contra
  `long-page.html`, `sticky-header.html`, `fixed-elements.html` — en verde
  (ver sección anterior). `fractional-dpr.html` queda pendiente para P2
  cuando se añada el ajuste de DPR fraccional al orchestrator.
- Tests Rust del compositor (heredados de P0, ampliados): tile único,
  multi-tile sin huecos/duplicados, DPR fraccional, encoder PNG streaming
  con round-trip de decodificación real.
- `cargo xtask build` ejecuta el pipeline completo (workspace → wasm32 →
  wasm-pack → `dist/chromium/`) de punta a punta sin intervención manual;
  las rutas de import del grafo compilado (`background/index.js` →
  `../wasm/screenshot_wasm.js`, etc.) se verificaron que resuelven en disco.
- **No verificado en este entorno**: carga real de la extensión en una
  ventana de Chrome/Edge con GUI y ejecución real de `captureVisibleTab()`
  contra una pestaña — este entorno de ejecución no tiene navegador GUI
  local ni acceso de red a un servidor localhost propio (Playwright aquí
  corre en un sandbox separado que solo alcanza internet pública, ni
  `file://` ni `127.0.0.1`). Queda como verificación manual pendiente,
  igual que en P0.

## Historial

| Fecha      | Commits de código                          | Cambio                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | `46b59f0`                                  | Creación del spec P1                                                                                                                                                                                                                                                                                                                                    |
| 2026-09-17 | `1deba96`, `0e97ac8`, `ba539eb`, `9919879` | Implementación completa de P1: rate limiter, compositor streaming, PNG streaming real, bridge WASM ampliado (composeFullPagePng, RateLimiter), capa capture/ del navegador (geometry/sticky/state/injectable/orchestrator), mensajería background↔popup, página de resultado sin permiso `downloads`. Verificado con Playwright contra fixtures reales. |
