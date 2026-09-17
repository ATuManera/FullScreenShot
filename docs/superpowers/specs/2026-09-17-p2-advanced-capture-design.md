# P2 — Advanced Capture: diseño

- Fecha: 2026-09-17
- Fase: P2 de P0–P6
- Estado: aprobado (continuación autorizada de todas las fases)

## Contexto

P1 dejó Capture Visible/Full Page funcionando sobre el documento completo.
P2 añade: capturar un contenedor con scroll propio, manejar contenido lazy,
y proteger contra páginas extremadamente altas/memoria.

## Alcance de P2

1. **Selected Scroll Area**: modo de selección visual (hover resalta
   contenedores candidatos con `overflow: auto|scroll` y `scrollHeight >
   clientHeight`), clic fija el elemento objetivo, y la captura recorre el
   scroll *interno* de ese elemento (no `window`) reutilizando el mismo
   `CapturePlan`/compositor de P1 pero con `scrollTop` del elemento en vez
   de `window.scrollTo`.
2. **Lazy loading — modos Fast/Reliable**: Fast captura durante el recorrido
   normal (comportamiento de P1, sin cambios). Reliable hace un pre-scroll
   acotado (límite configurable de pasadas) para disparar `img[loading=lazy]`
   y mutaciones de `scrollHeight`, y vuelve al inicio antes de capturar.
3. **Detección de scroll infinito**: si `scrollHeight` sigue creciendo tras
   el límite de pre-scroll de Reliable, se corta de forma controlada y se
   informa al usuario que la página es potencialmente infinita.
4. **Límites de memoria/tiles**: el límite de 100.000 tiles ya existe en
   `plan_tile_offsets` (P0); P2 añade un límite más bajo y configurable a
   nivel de orchestrator (p. ej. 500 tiles por defecto) con mensaje claro
   antes de iniciar una captura que lo excedería, para no depender solo del
   límite interno de Rust como única defensa.

Explícitamente fuera de P2: PDF, Markdown (P3); Safari (P4); auditoría de
dependencias (P5).

## Decisiones de diseño

- El compositor y `CapturePlan` de P0/P1 son agnósticos de si el scroll es
  de `window` o de un elemento — `plan_tile_offsets`/`CapturePlan::from_offsets`
  ya solo necesitan `viewport_height`/`content_height` genéricos. Para
  Selected Scroll Area, el orchestrator mide `scrollHeight`/`clientHeight`
  del elemento en vez de `document.documentElement`, y el paso de scroll
  inyectado hace `el.scrollTop = y` en vez de `window.scrollTo`. Cero
  cambios en Rust.
- Reliable mode: el límite de pre-scroll (número de pasadas o tiempo máximo)
  vive en TypeScript (es una política de UX/timing, no geometría pura) pero
  la *detección* de "altura sigue creciendo" es una comparación numérica
  simple, testeable sin DOM.

## Gate de salida de P2

- Tests Rust existentes siguen en verde (sin regresión).
- Nueva función pura `detectUnstableGrowth` (o equivalente) con tests
  Playwright/unitarios reutilizando el patrón de P1.
- Selected Scroll Area: lógica de detección de contenedor
  (`isScrollContainer`, ya existe desde P1) verificada contra
  `nested-scroll.html` con Playwright real.
- `cargo fmt/clippy/test`, `npm run typecheck` en verde.

## Historial

| Fecha | Commits de código | Cambio |
|---|---|---|
| 2026-09-17 | (se completa al finalizar P2) | Creación del spec P2 |
