# P7 — PDF híbrido buscable/seleccionable: diseño

- Fecha: 2026-09-19
- Fase: P7 (posterior a P0–P6)
- Estado: implementado, pendiente de verificación física del propietario

## Contexto

Hasta P6 el PDF de FullScreenShot era una imagen de la página: cada página
del PDF contenía una banda ráster de la composición y nada más. No se podía
buscar, seleccionar, copiar ni pulsar un enlace, porque no había texto — solo
píxeles.

P7 conserva intacta esa capa visual y le añade la mitad semántica.

Explícitamente **no** es un proyecto de OCR (sección 25 del encargo): el
texto ya está disponible, exacto, en el DOM.

## Alcance

1. Capa de texto invisible derivada del DOM sobre el ráster existente.
2. Anotaciones `/Link` para los hipervínculos renderizados.
3. Una única transformación de coordenadas, compartida con el compositor.
4. Metadatos mínimos del documento (`Title`, `Creator`, `Producer`).
5. Reporte honesto: la página de resultado solo dice «Searchable text»
   cuando el compositor informó de que colocó texto.

Fuera de alcance: PDF etiquetado (PDF/UA), OCR, `mailto:`, iframes de otro
origen, shadow roots cerrados, y cualquier cambio en la paginación visual
existente.

## Decisiones de diseño

### Arquitectura híbrida

El ráster de cada página es **byte a byte** el mismo que produciría el
export PNG — verificado comparando los XObject de imagen con y sin capa de
texto. Encima van:

- **Texto invisible** en modo de renderizado de texto **3**. No texto
  blanco, ni opacidad cero, ni fuente de un punto: los lectores interpretan
  esas aproximaciones de forma inconsistente y cualquiera de ellas podría
  verse sobre el screenshot que el PDF existe para preservar.
- **Anotaciones `/Link`** con `/Border [0 0 0]` y sin appearance stream: el
  screenshot ya muestra el enlace tal como la página lo dibujó, y un
  recuadro añadido por el lector sería la única marca que el PDF añade y la
  captura no tenía.

Véase ADR-0007 para las alternativas descartadas (HTML-a-PDF, OCR).

### Transformación de coordenadas — una sola

`screenshot_core::compositor::band_map` pasa a ser público. Es el mismo mapa
de bandas del que `compose_streaming` escribe píxeles, y ahora también del
que `screenshot_pdf::transform::SourceMapping` coloca glifos.

Tres espacios:

1. **CSS de origen** — lo que midió el DOM. Coordenadas de documento para
   Full Page; coordenadas de contenido del contenedor para Scroll Area.
2. **Píxeles de dispositivo del compositor** — alcanzados por el mapa de
   bandas, nunca por `y * dpr`.
3. **Espacio de usuario PDF** — puntos, origen abajo-izquierda, eje Y
   invertido, una página cada vez.

Por qué el mapa de bandas y no la aritmética CSS: en cada costura de scroll
el redondeo del propio navegador ya está contabilizado en las bandas. Este
proyecto ya pagó una vez por re-derivar posiciones desde CSS con DPR
fraccionario (`fix/fullpage-output-dimensions`), y aquí el mismo error
habría aparecido como texto desplazado respecto a sus palabras justo en las
pantallas más difíciles de probar. Hay tests a DPR 1, 1.25, 1.5, 1.75 y 2.

`PageLayout` centraliza además el troceado en páginas, redondeado a filas
enteras **una sola vez**, de modo que «qué filas hay en la página n» tiene
exactamente una respuesta para la imagen y para el texto.

### Granularidad: una ejecución por línea visual

Ni un objeto por carácter (sección 7) ni uno por nodo de texto. Un párrafo
que el navegador reparte en siete líneas produce siete ejecuciones.

Un nodo con **un solo** rectángulo se emite directo. Un nodo con varios se
mide palabra a palabra y se reagrupa por `top` con tolerancia de 2 px. Medir
por palabra solo cuando hay envoltura es lo que mantiene el coste acotado:
la mayoría de los nodos de una página (títulos, celdas, enlaces, elementos
de lista) tienen un único rectángulo.

Un rectángulo único alrededor de un párrafo de tres líneas colocaría toda la
cadena en la primera línea y haría que cualquier selección sobre él fuese
incorrecta.

### Orden de lectura

Orden del DOM, sin reordenar nunca por geometría. El extractor recorre el
árbol con una pila explícita (empujando los hijos en orden inverso para que
salgan en orden de documento) y el orden en que emite es el orden en que el
PDF lo muestra. La ordenación por Y/X destruiría el orden semántico en
cualquier maquetación de varias columnas.

Texto bidireccional: se emite en orden lógico. No se intenta reordenación
visual.

### Fuente — glifos en blanco, métricas exactas

Como el texto no se pinta, las formas no valen nada y las métricas lo son
todo. La fuente es un TrueType de ~490 bytes generado byte a byte en
`crates/screenshot-pdf/src/font.rs`: un único glifo vacío, direccionado por
`Type0`/`Identity-H` con `/ToUnicode`, `CIDToGIDMap` como stream de ceros
(todo CID → glifo 0) y `/DW 500` (sin array `/W`).

Consecuencias buscadas:

- **Unicode completo**, no una página de códigos. Una fuente base-14 como
  Helvetica no habría costado bytes pero habría truncado silenciosamente la
  capa de texto a Windows-1252.
- **Sin fuente de terceros y sin descargas**: no hay licencia que honrar ni
  blob binario en el repositorio.
- **Métricas predecibles**: todos los glifos miden media em, así que el
  factor que estira una ejecución hasta el ancho que midió el DOM es
  aritmética (`Tz = 200 · ancho / (n · tamaño)`), no una consulta a tablas.

La línea base se sitúa 0,21 em por encima del borde inferior de la caja que
midió el DOM (`getClientRects()` devuelve la caja ascender+descender de la
fuente).

Verificación: el OpenType Sanitizer de Chrome acepta la fuente.

### Semántica visual, no la del DOM

La capa de texto describe **la composición**, no el documento.

- **Fixed/sticky**: el compositor de Full Page conserva una barra superior
  en la primera banda y una inferior exactamente una vez, en la última. El
  extractor, por tanto, se ejecuta con la página arriba del todo y sin nada
  oculto, y desplaza las palabras de una barra `position: fixed` anclada
  abajo hasta la banda donde la imagen la dejó. `sticky` deliberadamente no
  recibe ese trato: arriba del todo un elemento sticky está en su posición
  de flujo, que es justo donde la primera banda lo muestra.
- **Fuera de la composición se descarta, no se recorta**: texto por debajo
  de la banda capturada de un área de scroll, o al lado de la columna
  capturada, se deja fuera. Apilarlo sobre la fila más cercana pondría texto
  invisible donde la imagen dice que no hay nada.
- **Corte de página**: un fragmento a caballo entre dos páginas se asigna a
  la que contiene su **centro** vertical. Aparece exactamente una vez;
  recortarlo escondería media palabra de la búsqueda y emitirlo en ambas
  haría tartamudear una selección copiada.

### Scroll Area

Se recorre solo el subárbol del contenedor y las coordenadas vuelven en
coordenadas de contenido del propio contenedor. Los dos ejes se tratan de
forma distinta a propósito: la captura mueve `scrollTop` entre bandas (por
eso la Y es relativa al contenido) pero nunca toca `scrollLeft` y recorta
cada banda en el borde izquierdo del contenedor en pantalla (por eso la X es
relativa a lo que está en pantalla).

Verificado en Chromium real: la extracción da resultados **idénticos** con
el contenedor arriba, a media altura y abajo — el contenido desbordado sí
tiene rectángulos utilizables y sumar `scrollTop` los hace independientes
del scroll. No hace falta extracción por etapas.

### Visible Area

`captureVisible` devuelve PNG y no ofrece PDF, por lo que la sección 16 del
encargo no tiene superficie sobre la que aplicarse. No se añadió una ruta
PDF para Visible Area en esta tarea: habría sido una función nueva de
producto, no la que se pidió.

### Filtrado

Se excluye lo que no está en la imagen: `display:none`,
`visibility:hidden|collapse`, `opacity:0`, `content-visibility:hidden`, el
atributo `hidden`, los rectángulos de tamaño cero, `script`/`style`/
`noscript`/`template`/`iframe`/`canvas`/`svg`/`video`/`audio`/`select`/
`option`, y la caja de 1 px con overflow recortado que usa el texto
«solo para lectores de pantalla».

`aria-hidden` **no** excluye: ese contenido sí se renderiza y sí está en el
screenshot.

### Enlaces

Solo `http:` y `https:`. `javascript:` y `data:` son los que importan — un
lector que los siga ejecutaría código suministrado por la página en el
contexto del lector — pero `blob:`, `file:` y `chrome-extension:` también se
rechazan, porque ninguno puede significar nada en la máquina que abra el
PDF, y un enlace que no hace nada es peor que ningún enlace. `mailto:` es
seguro pero queda fuera de V1.

La URL se resuelve con `element.href` (el navegador), nunca concatenando
rutas relativas a mano. El esquema se valida dos veces: en TypeScript al
extraer y en Rust al parsear JSON no confiable.

Un enlace que envuelve produce una anotación por rectángulo visible, de modo
que se puede pulsar entero y no solo su primera mitad.

### Degradación y honestidad

Si la extracción falla, el PDF visual se produce igualmente, la consola dice
por qué, y el resultado almacenado registra `textLayer=false`. La página de
resultado solo añade «Searchable text» cuando el compositor informó de
haber colocado fragmentos — nunca por el mero hecho de que el formato sea
PDF.

### Entrada no confiable

El JSON del extractor cruza la frontera WASM y se valida en un único punto
(`TextLayer::from_untrusted_json`), igual que el AST de Markdown en P3.
Entradas malformadas *individuales* se descartan; un JSON que no es una capa
de texto es un error, porque eso sería un fallo de la extensión y no una
página rara.

## Gate de salida de P7 — resultado real

- Tests Rust: 168 (55 core + 32 md + 2 md-integration + 3 + 58 pdf + 11
  pdf-integration + 7 png), 0 fallos.
- Tests Node: 206, 0 fallos.
- `cargo fmt --check`, `cargo clippy -D warnings`, `npm run typecheck` —
  en verde.
- `cargo audit`, `cargo deny check` — sin vulnerabilidades ni licencias
  fuera de la lista permitida; no se añadió ninguna dependencia de terceros
  nueva (`serde`/`serde_json` ya estaban en el workspace por
  `screenshot-md`).
- **Integración real navegador→Rust**: el extractor compilado se ejecutó con
  Playwright contra `tests/pages/pdf-text-acceptance.html` y
  `tests/pages/scrollarea-single.html` en un Chromium real a 1200×800; el
  JSON exacto que produjo se capturó verbatim como fixture en
  `crates/screenshot-pdf/tests/fixtures/` y se procesó con el pipeline Rust
  real.
- **Validación con herramientas externas**: `qpdf --check` no encuentra
  errores de sintaxis ni de stream; `pdftotext` extrae los marcadores
  superior, intermedio e inferior en orden, con acentos intactos y sin
  ninguna de las cinco variantes de texto oculto; el visor PDF de Chrome
  (PDFium) abre el archivo, muestra el título de los metadatos y **no
  dibuja nada** sobre el ráster.
- **Rendimiento**, medido en Chromium sobre una página de ~29.400 palabras
  y 128.520 px de alto: 50–74 ms de extracción, 2.577 fragmentos, 140
  anotaciones de enlace, 0,37 MiB de JSON serializado. La fixture de
  aceptación: 1 ms, 49 fragmentos.
- **Regresión PNG**: la salida del compositor PNG se comparó contra la base
  (`9bb65cb`) componiendo 4 geometrías × 5 DPR (1, 1,25, 1,5, 1,75, 2),
  incluido el caso de DPR fraccionario que motivó
  `fix/fullpage-output-dimensions`. Las 20 composiciones son **idénticas
  byte a byte**: la refactorización del compositor no cambió un solo píxel.
- **Tamaño**: el WASM pasa de 305.478 a 354.133 bytes (+48.655, +15,9 %).
- `cargo xtask build` regenera `dist/chromium/` con el nuevo export
  `PdfComposeResult`; permisos sin cambios: `["activeTab", "scripting",
  "storage"]`.

## Limitaciones conocidas (documentadas, no ocultas)

- Texto dentro de imágenes, `<canvas>`, WebGL y PDF/plugins incrustados
  sigue siendo solo ráster. No hay DOM del que leerlo y el OCR está fuera de
  alcance.
- Iframes: no se recorren. Los de otro origen son inaccesibles sin permisos
  de host que el producto no pide; los del mismo origen se dejaron fuera
  para no introducir una ruta que solo funcionaría a veces.
- Shadow roots abiertos sí se recorren; los cerrados no son accesibles.
- No es un PDF etiquetado: no hay árbol de estructura, no es PDF/UA, y no
  debe describirse como «PDF accesible» — solo como uno cuyo texto se puede
  encontrar, leer y copiar.
- Texto bidireccional en orden lógico, sin reordenación visual.
- En Scroll Area, un overlay `position: fixed` que cubra el contenedor
  aparece en la imagen pero no en la capa de texto (no es descendiente del
  contenedor).
- Búsqueda/selección/copia/pulsación **dentro del visor PDF de Chrome** no
  se pudieron automatizar: el plugin no expone su árbol de accesibilidad ni
  su barra de búsqueda a la automatización. Verificado en su lugar con
  poppler y PDFium por separado; la comprobación interactiva queda para el
  gate físico del propietario.

## Historial

| Fecha      | Commits de código                | Cambio                                                                                                                                               |
| ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-19 | `7369f03`                        | Núcleo Rust: mapa de bandas público, `transform`, `text_layer`, `font` glyphless, generador híbrido con texto invisible y anotaciones de enlace.       |
| 2026-09-19 | `e10ae30`                        | Extractor DOM en la extensión, puente WASM `PdfComposeResult`, wiring de Full Page y Scroll Area, metadatos de resultado y copia honesta en Result.    |
| 2026-09-19 | `dae8458`                        | Fixture de aceptación, fixture de scroll area ampliada, fixtures capturadas en Chromium real y tests de integración; corrección de espacios inline.    |
