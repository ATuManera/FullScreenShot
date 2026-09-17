# P3 — PDF + Markdown export: diseño

- Fecha: 2026-09-17
- Fase: P3 de P0–P6
- Estado: aprobado (continuación autorizada de todas las fases)

## Contexto

P0 dejó `screenshot-pdf::paginate` (paginación pura, sin generar bytes PDF
reales) y `screenshot-md` (AST + writer determinístico, sin extracción real
del DOM). P3 completa ambos: un PDF real multi-página a partir de la misma
composición usada para PNG, y una extracción real DOM→AST ejecutada en el
content script/orchestrator.

## Alcance de P3

### PDF

1. Generación de bytes PDF reales y válidos (no solo planificación de
   páginas) usando la crate `pdf-writer` (Apache-2.0/MIT, sin dependencias
   nativas, compatible con `wasm32-unknown-unknown`) — visual/raster, cada
   página es una imagen (no HTML renderizado).
2. `PageSize`: `A4`, `Letter` (tamaño físico fijo en puntos PDF, escala
   "Fit Width": el ancho de la composición se ajusta al ancho de página) y
   `Auto` (tamaño de página = tamaño de la composición, escala "Original
   Scale" 1:1 — evita la combinación inválida de "tamaño físico fijo +
   escala 1:1" que produciría desbordes o huecos arbitrarios).
3. `Orientation`: `Portrait`/`Landscape` (intercambia ancho/alto de página).
4. Paginación reutilizando `paginate()` de P0 sobre la altura de contenido
   ya compuesta, evitando cortar una página a mitad de un tile cuando existe
   alternativa simple (usar directamente los saltos de banda del compositor
   como candidatos de corte cuando coincide con el alto de página).

### Markdown

1. Content-script real que recorre el DOM (Article: intenta quedarse con
   `<article>`/`<main>` o heurística de contenido principal; Full DOM:
   recorre `document.body` completo) y produce el AST ya definido en P0
   (`screenshot_md::ast::Node`), serializado a JSON para cruzar el límite
   WASM (el AST no cruza como objetos JS complejos; cruza como JSON
   validado, tratado como no confiable en el lado Rust).
2. `screenshot_md::ast::Document` gana un parser JSON→AST validado (rechaza
   estructuras no reconocidas en vez de entrar en pánico) para consumir ese
   JSON de forma seguro (sección 22: "toda entrada del DOM es no
   confiable").
3. Cabecera YAML (`title`, `source`, `captured_at`, `generator`,
   `repository`) generada por el writer, no por el content script.
4. Sanitización ya existente (`sanitize_href`) se extiende a bloquear
   también `data:` URLs con esquema ejecutable y a marcar imágenes/canvas/
   WebGL no representables con una nota textual (sección 19).

Explícitamente fuera de P3: Safari (P4); auditoría de dependencias (P5);
empaquetado de artefactos (P6).

## Decisiones de diseño

- El PDF reutiliza la MISMA composición (`compose_streaming`) que el PNG:
  se compone una vez a un buffer RGB en memoria (sin alfa, compuesto sobre
  blanco) y se rebana por página. Esto es una excepción documentada y
  acotada solo a PDF frente al principio de "no bitmap gigante" de
  ADR-0004 (que sigue aplicando sin cambios al compositor de PNG): el PNG
  del mismo contenido ya demostró que el tamaño es manejable, y la
  paginación PDF necesita acceso aleatorio a bandas de filas no
  contiguas por página, lo que no encaja con un `RowSink` de una sola
  pasada sin complejizar la interfaz para todos sus consumidores.
- El AST de Markdown cruza el límite JS↔WASM como JSON, no como objetos
  complejos wasm-bindgen — más simple, más auditable, y permite validar
  explícitamente la entrada no confiable en un solo punto de entrada
  (`Document::from_untrusted_json`).

## Gate de salida de P3

- Tests Rust de `screenshot-pdf`: PDF válido (cabecera `%PDF`, `%%EOF`,
  conteo de páginas correcto vía escaneo estructural), multi-página,
  A4/Letter/Auto, Portrait/Landscape.
- Tests Rust de `screenshot-md`: parser JSON→AST rechaza entrada
  malformada/hostil sin panic; escritura de cabecera YAML determinística.
- PNG sigue sin regresiones (P0/P1/P2 en verde).
- `cargo fmt/clippy/test`, `npm run typecheck`, `npm test` en verde.

## Historial

| Fecha | Commits de código | Cambio |
|---|---|---|
| 2026-09-17 | (se completa al finalizar P3) | Creación del spec P3 |
