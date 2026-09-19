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
- **Revisado — el popup cede el foco cuando el picker está armado.** Mientras
  el popup está abierto retiene el teclado, así que un Escape destinado al
  picker solo lo cerraba a él: cancelar exigía dos pulsaciones. El background
  emite `PICKER_ARMED` una vez que `executeScript(runSelectionPicker)` ha
  resuelto **con candidatos**, la respuesta a `START_CAPTURE` incluye el
  `sessionId` iniciado, y el popup ejecuta `window.close()` solo ante un
  anuncio de su propia sesión. Ni un fallo de inyección ni una página sin
  candidatos generan el mensaje, de modo que el popup nunca se cierra sobre
  la nada; y un anuncio de una captura anterior no puede cerrar un popup que
  ya se está usando para otra cosa. Sin permisos nuevos y sin reenvío
  sintético de teclado: basta con quitarse de en medio.
- **Revisado — cancelar no es fallar, y entregar no es asumir.** El desenlace
  del picker se colapsaba a `selector | null` en `resolveResult`, de modo que
  "el usuario decidió no elegir" y "no había nada que elegir" emitían ambos
  `NO_CONTAINER_SELECTED`, que el popup muestra como error rojo. Es correcto
  para una página sin regiones scrollables y equivocado para un Escape
  deliberado. Los desenlaces quedan separados de extremo a extremo:
  `cancelled` (Escape o clic fuera de todo candidato) → `CANCELLED`;
  `no-candidates` (la página cambió entre el análisis y el picker) →
  `NO_CONTAINER_SELECTED`; `error` → se propaga.
- **Revisado — entrega confirmada del desenlace.** El mensaje terminal se
  emitía con `chrome.runtime.sendMessage` sin esperar ni comprobar que
  alguien lo recibiera. Si la entrega fallaba —sin receptor en ese instante,
  worker reiniciándose, contexto de extensión invalidado— la página quedaba
  limpia y el background seguía esperando, sin nada que cerrara la selección
  salvo su watchdog de 90 s: una acción determinista del usuario degradada a
  un timeout. Ahora el background responde `{ received: true }` y la página
  reintenta unas pocas veces en bastante menos de un segundo si no llega ese
  acuse. Un mensaje de otra selección se deja deliberadamente sin acusar,
  para que un picker sobrante de una sesión anterior se detenga en vez de
  reintentar contra una captura que no le corresponde.
- **Revisado**: el aviso "Choose a scroll area on the page" viaja por
  `onProgress` y no por un broadcast suelto, para que `GET_STATE` refleje que
  se está esperando una elección; un popup reabierto a media selección
  reconstruía "Locating scroll area…" desde un estado que nadie actualizaba.
  El guard de captura se libera antes de emitir el mensaje terminal.
- **Revisado**: la preferencia Fast/Reliable se persistía y se mostraba, pero
  no llegaba a la captura — `START_CAPTURE` no tenía campo para ella, el popup
  no la leía y el background llamaba a `captureFullPage(..., "fast", ...)`
  incondicionalmente. Ahora `lazyMode` viaja en el mensaje (campo ausente →
  default documentado, igual que el resto de campos opcionales del contrato;
  campo presente con valor no reconocido → se rechaza el mensaje entero, para
  que un mensaje suplantado no pueda elegir la ruta de captura).
- **Revisado**: la decisión por pasada de seguir o parar se leía de
  `classifyPrescrollOutcome`, que responde otra pregunta ("al llegar al
  límite, ¿seguía creciendo?") y devuelve `"settled"` para cualquier número de
  muestras por debajo del límite. Consultarla en cada pasada cortaba siempre
  tras exactamente dos, por mucho contenido que siguiera llegando, y dejaba el
  veredicto de scroll infinito inalcanzable, porque alcanzarlo exige las
  muestras que el bucle nunca llegaba a reunir. La decisión por pasada es
  ahora `isStillGrowing` — el predicado que existe justamente para eso y ya
  estaba testeado — y el veredicto de límite alcanzado queda después del
  bucle. El límite sigue siendo de ocho pasadas.
- El plan de captura se sigue midiendo **después** del pre-scroll, así que el
  contenido que solo aparece al pre-scrollear entra en la altura desde la que
  se planifica, y el pre-scroll termina con un scroll verificado al tope para
  que el primer tile sea la verdadera cabecera de la página.

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
| 2026-09-18 | `98780c2` | Reliable mode cableado de extremo a extremo (`lazyMode` en el contrato `START_CAPTURE`, validado y propagado hasta `captureFullPage`) y reparación de la condición de parada del pre-scroll. Verificado en Chromium con `tests/pages/lazy-fullpage-acceptance.html`: Fast 1200x2100 con 3 secciones, Reliable 1200x4200 con 6. |
| 2026-09-18 | `e121f5e`, `60862db` | Desenlaces terminales de la selección: Escape se reporta como cancelación y no como error, `no-candidates` se separa de `cancelled`, el desenlace se entrega con acuse y reintento acotado, y el estado autoritativo refleja la espera. Medido en Chromium: Escape → idle en 7 ms. |
| 2026-09-18 | `e1cc3e0` | Traspaso explícito del picker: `PICKER_ARMED` por sesión, el popup se cierra solo cuando hay picker que recibir al usuario, y una sola pulsación de Escape cancela. Medido en Chromium: popup cerrado ~100 ms tras armar; Escape → idle en 255 ms. |
