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
está anclado al viewport, no al scroll. La estrategia sigue siendo reversible
(atributo de datos + `visibility:hidden`, nunca remover del DOM, restaurado
tras cada captura), pero la regla original — "ocultar en los tiles 2..N y
mostrar todo en el primero" — resultó incompleta: la salida conserva de cada
tile solo la banda hasta el origen del tile siguiente, y una barra anclada
abajo vive justo en la parte del primer viewport que el stitcher descarta.
Medido sobre `tests/pages/fullpage-acceptance.html`: el sticky header aparecía
una vez en las filas 0-55 y el footer fixed **no aparecía en absoluto** — ni
duplicado ni conservado.

La regla revisada decide por **anclaje**, no por índice de tile:

- **TOP** (barra contra el borde superior): visible en la primera banda
  retenida, oculta en el resto.
- **BOTTOM** (barra contra el borde inferior): oculta en todas las bandas
  salvo la última, que es el único lugar donde puede aparecer exactamente una
  vez (es el único tile del que se conserva el viewport completo).
- **OTHER** (widget flotante, overlay centrado, elemento demasiado estrecho
  para ser una barra o tan alto como el viewport): conserva el tratamiento de
  siempre, sin inventar semántica nueva.

`classifyFixedAnchor` (sticky.ts, puro y testeado; espejado dentro del
inyectable) clasifica por geometría y no por los valores computados de
`top`/`bottom`: los autores escriben `top: 8px` o `calc()`, y Chrome devuelve
valores *usados* para elementos posicionados, así que el lado declarado no es
una señal fiable.

La banda final se **vuelve a capturar** con solo los elementos BOTTOM
visibles, en lugar de decidir por adelantado cuál será el último tile. El
bucle no puede saberlo mientras todavía descarta offsets que Chrome clampea
sobre un viewport ya capturado, y en una página que crece durante la captura
una conjetura pegaría el footer en mitad de la imagen. La captura extra se
omite por completo cuando la página no tiene ninguna barra anclada abajo, que
es el caso abrumadoramente mayoritario. Una captura de un solo viewport
conserva todo, porque la salida *es* el viewport.

## Estrategia de stitching (decisión de diseño)

Reutiliza `CapturePlan`/`Tile` de P0: cada tile tiene un `scroll_offset.y`.
El compositor asigna a cada tile una banda de filas de salida
`[offset_i, offset_{i+1})`, sin solapamiento en la imagen final — el overlap
del plan de P0 es solo margen de tolerancia para que capturas con
timing/redondeo ligeramente distintos igual cubran el contenido completo, no
una zona de blending. Esto evita costuras visibles sin necesitar comparación
de píxeles entre tiles adyacentes.

**Revisado — la banda final la define el screenshot, no la aritmética CSS.**
El diseño original hacía que el último tile cubriera "hasta `content_height`"
y derivaba la altura de salida de `round(content_height * dpr)`. Eso mezcla
dos autoridades distintas: la altura declarada venía de geometría CSS, y las
filas venían de screenshots que el navegador rasteriza con su propio
redondeo. Con DPR entero ambas coinciden siempre. Con DPR fraccionario —el
del dueño es 1.5— discrepan en algunas posiciones de scroll: con un viewport
de 657px a DPR 1.25 el navegador devuelve 821 filas donde
`round((offset + viewport) * dpr) - round(offset * dpr)` pide 822. El último
tile no podía aportar la fila exigida, el clamp `.min(image.height)` escribía
una menos en silencio, y el chequeo de contabilidad de filas fallaba
reportando el número de filas *escritas* — que llegaba al usuario como
`invalid dimensions: 1660x8484` y parecía un límite de tamaño inexistente.

Ahora la banda final **es** el último screenshot, y la altura de salida es la
suma de las bandas que cada tile aporta realmente (`planned_band_rows`).
`expected_output_height`, que el escritor PNG pone en la cabecera antes de
transmitir una sola fila, se calcula desde la misma función, de modo que la
altura declarada y la escrita no pueden divergir. Las alturas de tile pueden
diferir entre sí por el redondeo del navegador; los anchos no.

**Política de dimensiones.** No existía ninguna (ni `MAX_WIDTH`, ni 8192, ni
`u16`). Se añade un presupuesto de píxeles —no un tope por eje, porque una
imagen larga es el propósito del producto— de `MAX_COMPOSITE_PIXELS = 100_000_000`
(~400MB de RGBA, ~1GB de working set, siete veces la captura que falló), con
toda la aritmética de bytes en `u64` comprobado: este crate compila a wasm32,
donde `usize` es de 32 bits y `width * height * 4` se desbordaría en silencio.
Superarlo produce `CoreError::TooLarge`, distinto de `InvalidDimensions`, para
que una página honestamente enorme no se confunda con una malformada.

## Estrategia de scroll (revisada — reparación de runtime)

El diseño original trataba los offsets de `plan_tile_offsets` como el origen
de banda de cada tile: se pedía `window.scrollTo(0, offsets[i])` y ese mismo
valor se pasaba al compositor. Esa equivalencia es falsa. Pedir un scroll no
es haber scrolleado: Chrome clampea al llegar al fondo, y hay páginas —
motores de scroll propios, scroll-jacking, app shells — que aceptan la llamada
y se quedan donde estaban. El compositor, al que se le decía que N viewports
idénticos venían de N offsets distintos, los cosía en un PNG alto y la captura
reportaba éxito: la imagen de "página completa" hecha de un viewport repetido.

La regla ahora es que **el origen de banda es la posición alcanzada, nunca la
solicitada**. Cada tile pasa por `scrollWindowToVerified`, que espera dos
frames compositados (`requestAnimationFrame` encadenado) y lee `window.scrollY`
de vuelta junto con el máximo de scroll vigente. `decideTile` clasifica el
resultado:

- posición alcanzada distinta de la anterior → se captura, con esa posición
  como origen de banda;
- misma posición que el tile anterior y la pedida estaba fuera de alcance
  (clamp de Chrome al fondo) → se descarta el tile, no se cose dos veces;
- misma posición que el tile anterior y la pedida era alcanzable → la página
  se negó a scrollear: se aborta con mensaje accionable en vez de producir
  una captura plausible pero falsa.

`allCapturedTilesIdentical` es la defensa de último recurso para una página
que reporta un `scrollY` que se mueve mientras renderiza siempre lo mismo;
solo dispara cuando *todos* los tiles de una captura multi-tile y multi-posición
son idénticos, de modo que una franja en blanco que abarque dos tiles en una
página normal nunca la activa.

Los dos frames de espera también cierran una carrera más silenciosa: el rate
limiter devuelve 0 ms para la primera llamada, así que el tile 1 podía
capturarse antes de que se pintara el scroll al tope, registrando el viewport
previo del usuario como si fuera la cabecera de la página.

La estrategia de fixed/sticky y la de stitching descritas arriba no cambian;
lo único que cambia es de dónde salen los offsets que recibe el compositor
(y que el conteo de "primer tile" ahora se lleva sobre tiles efectivamente
capturados, no sobre el índice del plan, para que un tile descartado no deje
al primero con sus elementos fixed ocultos).

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
| 2026-09-18 | `5ca678d`, `273172d`                          | Reparación de runtime de Full Page: verificación de la posición de scroll alcanzada antes de componer, descarte de tiles clampeados, aborto ante página que no scrollea, y salvaguarda de tiles idénticos. Reproducido y verificado en Chromium real con `tests/pages/scroll-jacked-page.html` y `tests/pages/fullpage-acceptance.html`. |
| 2026-09-18 | `ede00b7`                                   | Política de elementos fijos por anclaje: TOP en la primera banda retenida, BOTTOM en la última (mediante recaptura de esa banda), OTHER sin cambios. Cierra la pérdida del footer fixed. Verificado en Chromium con `fullpage-acceptance.html` y `fixed-elements.html` a DPR 1 y 2. |
| 2026-09-18 | `e03daae`, `a53bfb3`                        | Reparación del fallo físico de dimensiones: la banda final se toma del screenshot real en vez de derivarse de geometría CSS, altura declarada y escrita unificadas, política de presupuesto de píxeles con aritmética comprobada y error `TooLarge` propio, y dimensiones reportadas leídas de la cabecera PNG. Verificado en Chromium a DPR 1, 1.25, 1.5, 1.75 y 2. |
