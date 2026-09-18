# P2 — Advanced Capture: diseño

- Fecha: 2026-09-17
- Fase: P2 de P0–P6
- Estado: aprobado 

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

## Decisiones revisadas (reparación de runtime)

**La selección deja de ser una promesa viva en el service worker.** El diseño
original inyectaba una función `async` cuya promesa resolvía al hacer clic, y
el background esperaba esa única llamada a `executeScript`. Hacer clic fuera
de todo candidato no resolvía nada, de modo que el flujo quedaba pendiente sin
desenlace posible y la página conservaba indefinidamente los contornos, los
atributos marcadores y los listeners en fase de captura — `cleanup()` solo
corría en los caminos que resolvían. A eso se suman dos hechos de MV3 y de
Chrome: un service worker se desaloja tras ~30 s de silencio (esperar a una
persona es exactamente eso), y el clic que cierra el popup es consumido por el
cierre y nunca llega a la página.

La selección viaja ahora como un mensaje de runtime serializable etiquetado con
el id de su petición (`selectionProtocol.ts`). `runSelectionPicker` se instala
y retorna de inmediato; clic en candidato, clic fuera, Escape, navegación y su
propio plazo restauran la página y reportan exactamente un desenlace, así que
la limpieza de la página ya no depende de que alguien escuche. El background
además resuelve ante cierre de pestaña, ante Cancel y ante su propio plazo
acotado — el timeout es una salvaguarda *detrás* del ciclo de vida, no un
sustituto. Un heartbeat mantiene al worker residente solo durante la ventana de
selección.

**La geometría del contenedor se establece, no se asume.** El rectángulo se
medía una vez y se reutilizaba para todos los recortes, sin garantizar que el
contenedor estuviera en pantalla; uno por debajo del pliegue producía recortes
clampeados a los límites de la captura, tiles de alturas distintas y el error
crudo `invalid dimensions: 640x64` llegando al usuario.
`prepareContainerForCapture` lo trae a la vista y reporta la banda realmente
visible. `positionContainerBand` coloca cada fila pedida en el tope de esa
banda combinando `element.scrollTop` con el **mínimo** desplazamiento de página
necesario: un contenedor más alto que la ventana no puede subir por sí solo las
filas que quedan más allá de `scrollHeight - clientHeight`, y sin ese
complemento un panel de 900 px en una ventana de 657 px perdía en silencio sus
últimos 243 px de contenido. Esto es la excepción prevista en "alterar
`element.scrollTop`, no `window.scrollY`, salvo que haga falta para mantener
visible el contenedor".

La afirmación de P2 de que el orchestrator solo necesita `scrollHeight`/
`clientHeight` del elemento sigue siendo cierta para el núcleo Rust (cero
cambios en Rust), pero la altura de tile ya no es `clientHeight`: es la banda
visible.

`captureScrollArea` restaura el `scrollTop` original del contenedor en vez de
ponerlo en 0, elimina el atributo marcador y deshace el scroll de página que
introdujo. `selectSoleScrollCandidate` incorpora el filtro de intersección con
el viewport que `detectScrollCandidates` ya aplicaba, para que la clasificación
0/1/N del popup y la decisión de captura directa del background no puedan
discrepar.

## Gate de salida de P2 — resultado real

- Tests Rust: 60 passed, 0 failed (sin regresión respecto a P1).
- `capture/lazy.ts` (`isStillGrowing`, `classifyPrescrollOutcome`): 7/7 tests
  reales vía `node --test` contra el output compilado (nuevo lane de test
  sin dependencias añadido en esta fase).
- Selected Scroll Area: verificado en vivo con Playwright contra
  `nested-scroll.html` — detección del candidato `#scroll-container`,
  resolución correcta al hacer clic (`{attr, value: "0"}`), limpieza del
  atributo marcador tanto en el camino "elegido" como en el de
  cancelación con Escape (el fix de `cleanup(keepAttrOn)` se verificó
  después de corregir un bug real: el atributo quedaba en candidatos no
  elegidos).
- `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test --workspace`,
  `npm run typecheck`, `npm test` (Node) — todos en verde, unificados en
  `cargo xtask test`.
- CI (`ci.yml`) ejecuta `npm test` además de `npm run typecheck`.

## Historial

| Fecha      | Commits de código | Cambio                                                                                                                                                                                                                                        |
| ---------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | `3187cbd`         | Creación del spec P2                                                                                                                                                                                                                          |
| 2026-09-17 | `52cfc50`         | Implementación completa de P2: Selected Scroll Area con selección interactiva verificada en Chromium real, modo Reliable de lazy-loading con detección de scroll infinito, límite de seguridad de tiles, lane de tests Node sin dependencias. |
| 2026-09-18 | `02ad6b7`, `273172d` | Reparación de runtime de Selected Scroll Area: ciclo de vida de selección serializable y terminal (mensaje + desenlace único + limpieza del lado de la página), contenedor traído a la vista con banda visible real, y restauración completa de `scrollTop`, marcador y scroll de página. Verificado en Chromium real con `tests/pages/scrollarea-single.html` y `tests/pages/scrollarea-multiple.html`. |
