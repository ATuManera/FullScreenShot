# P4 — Safari: diseño

- Fecha: 2026-09-17
- Fase: P4 de P0–P6
- Estado: aprobado

## Contexto

El host de este entorno es macOS 26.5.2, pero solo tiene instaladas las
**Command Line Tools** (`/Library/Developer/CommandLineTools`), no el
Xcode.app completo (`xcodebuild -version` falla explícitamente pidiendo
Xcode). `xcrun safari-web-extension-converter` — la herramienta que
convierte una extensión web estándar en un proyecto Xcode de Safari App
Extension — solo se instala con Xcode.app completo, y no está disponible
aquí. Esto es una limitación física verificada del entorno, no una
suposición.

Sección 7 del prompt maestro exige separar explícitamente:

1. **Compatibilidad técnica** — ¿el código de la extensión (manifest,
   `chrome.*`/`browser.*` APIs usadas) es compatible con el modelo de
   Safari Web Extensions?
2. **Packaging** — generar el proyecto Xcode / bundle `.appex`.
3. **Code signing** — firmar con un certificado de Apple Developer.
4. **App Store submission** — publicar en la App Store.

Este entorno solo puede abordar (1) de forma verificable y dejar (2)
preparado pero no ejecutado; (3) y (4) quedan fuera de alcance de
cualquier entorno automatizado sin credenciales de Apple Developer, y no
se intentan.

## Alcance de P4

1. **Análisis de compatibilidad técnica** (`browser/safari/README.md`):
   qué partes de la extensión ya construida (P0–P3) son compatibles con
   Safari Web Extensions según la documentación pública de Apple, y qué
   riesgos quedan sin verificar por falta de un runtime Safari real aquí.
2. **Script de conversión preparado** (`browser/safari/convert.sh`): invoca
   `xcrun safari-web-extension-converter` sobre `dist/chromium/` con las
   opciones documentadas por Apple. Si la herramienta no está disponible
   (como en este entorno), falla con un mensaje claro y accionable — nunca
   simula éxito.
3. **`cargo xtask package safari`**: subcomando que ejecuta el script
   anterior, documentado en `CONTRIBUTING.md`/`README.md`.
4. **No se modifica código Chrome/Edge ya probado** con "arreglos" de
   Safari especulativos y no verificables en este entorno — el riesgo de
   romper algo que sí funciona, a cambio de un beneficio que no se puede
   confirmar, no es aceptable (sección 37: "primero corrección").

Explícitamente fuera de P4: firma de código, submission a App Store,
cualquier credential de Apple Developer.

## Gate de salida de P4

- `browser/safari/README.md` documenta con precisión qué se verificó y
  qué no, con la razón exacta (ausencia de Xcode.app completo).
- `browser/safari/convert.sh` existe, es ejecutable, y fallar limpiamente
  en este entorno es el resultado CORRECTO y esperado (no un fallo del
  gate) — se verifica que el mensaje de error es claro, no que el
  comando tenga éxito.
- `cargo xtask package safari` expone el subcomando.
- Todo el gate de Chrome/Edge (P0–P3) sigue en verde sin regresión.

## Gate de salida de P4 — resultado real

- `browser/safari/README.md` escrito con la tabla de estado exacta y el
  análisis de compatibilidad (probable vs. riesgo no verificado).
- `browser/safari/convert.sh` ejecutado realmente en este entorno:
  falla con `exit_code=1` y el mensaje claro esperado ("xcrun:
  safari-web-extension-converter is not available... install Xcode").
  Este es el resultado CORRECTO, no un fallo del gate.
- `cargo xtask package safari` ejecutado: propaga el mismo fallo
  limpiamente (mismo exit code, mismo mensaje).
- `cargo xtask package chromium` ejecutado con éxito real:
  `artifacts/fullscreen-shot-chromium-0.1.0.zip` generado (162.896
  bytes), contenido verificado (manifest.json, background/, popup/,
  options/, result/, wasm/, browser/, capture/ — todo lo esperado).
- Verificación de consistencia de versión (nueva, sección 31 del
  prompt maestro) ejecutada: `extension/manifest.base.json` y
  `extension/package.json` coinciden con la versión del workspace
  Cargo.toml (`0.1.0`).
- Gate completo de Chrome/Edge (P0–P3): 92 tests Rust + typecheck +
  tests Node, sin regresión.
- No se modificó código de captura ya probado en Chrome/Edge con
  cambios especulativos de Safari.

## Historial

| Fecha      | Commits de código | Cambio                                                                                                                                                                                                                 |
| ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | `fc6c923`         | Creación del spec P4                                                                                                                                                                                                   |
| 2026-09-17 | `4e44508`         | Preparación completa de Safari: análisis de compatibilidad, script de conversión (falla limpiamente sin Xcode completo, verificado), `cargo xtask package chromium/safari`, verificación de consistencia de versiones. |
