# P1 — Chrome/Edge Capture Visible + Capture Full Page → PNG: diseño

- Fecha: 2026-09-17
- Fase: P1 de P0–P6
- Estado: aprobado (el usuario autorizó continuar y completar todas las fases sin pausas de confirmación por fase)

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

## Historial

| Fecha | Commits de código | Cambio |
|---|---|---|
| 2026-09-17 | (se completa al finalizar P1) | Creación del spec P1 |
