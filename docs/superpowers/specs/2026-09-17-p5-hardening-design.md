# P5 — Hardening: diseño

- Fecha: 2026-09-17
- Fase: P5 de P0–P6
- Estado: aprobado 

## Contexto

P0–P4 dejaron una extensión funcional en Chrome/Edge con PNG/PDF/Markdown,
y Safari preparado hasta donde el entorno lo permite. P5 es una pasada de
seguridad real sobre lo ya construido: auditoría de dependencias, revisión
de permisos, fixtures DOM hostiles, y validación de mensajes — no nueva
funcionalidad de producto.

## Alcance de P5

1. **`cargo audit`**: instalado (no estaba en el entorno) y ejecutado
   contra el `Cargo.lock` real del workspace. Cualquier advisory se
   documenta explícitamente; no se ignora en silencio.
2. **`cargo deny`**: instalado y configurado (`deny.toml`) para
   `licenses`, `advisories`, `bans`, `sources`, ejecutado contra el
   workspace real.
3. **Revisión de permisos**: confirmar que el manifest final solo pide
   `activeTab`, `scripting`, `storage` (sin `<all_urls>`, sin `debugger`,
   sin `webRequest`) — ya cierto desde P0/ADR-0002, se re-verifica aquí
   contra el `dist/chromium/manifest.json` real, no solo el código fuente.
4. **CSP**: se re-verifica que `content_security_policy.extension_pages`
   no permite scripts remotos.
5. **Validación de mensajes**: ya implementada desde P2
   (`parseInboundMessage` en `background/messages.ts`) — aquí se añaden
   tests explícitos de mensajes hostiles/malformados.
6. **Fixture DOM hostil**: página de prueba con estructuras adversariales
   (enlaces `javascript:`/`data:`, profundidad de anidación extrema,
   `<script>`/`<style>` que deben ignorarse) para ejercer el extractor de
   Markdown y el sanitizador contra contenido deliberadamente hostil, más
   allá de lo ya cubierto por tests unitarios sintéticos.
7. **Revisión de terceros**: confirmar que `THIRD_PARTY_NOTICES.md` está
   completo y coincide con las dependencias reales del `Cargo.lock`.

Explícitamente fuera de P5: nueva funcionalidad de producto, cambios de
arquitectura no motivados por un hallazgo de seguridad concreto.

## Gate de salida de P5

- `cargo audit` ejecutado con resultado real documentado (no "debería
  estar limpio" sino la salida real).
- `cargo deny check` ejecutado con resultado real documentado.
- Tests de mensajes hostiles en `background/messages.ts` en verde.
- Fixture DOM hostil (`tests/pages/hostile-content.html`) ejercida contra
  el extractor de Markdown real (Playwright), confirmando que scripts no
  se ejecutan y que los enlaces peligrosos se sanitizan en el pipeline
  Rust real, no solo en teoría.
- `THIRD_PARTY_NOTICES.md` verificado contra `cargo tree`/`Cargo.lock`
  real.
- Sin hallazgos críticos o altos sin documentar (spec del prompt maestro,
  sección 26).

## Gate de salida de P5 — resultado real

- `cargo audit` (instalado en este pase, no preexistía): **0
  vulnerabilidades** en 77 dependencias.
- `cargo deny check`: **advisories ok, bans ok, licenses ok, sources
  ok** (2 warnings informativos de versiones duplicadas —bitflags,
  miniz_oxide—, no bloqueantes). `deny.toml`'s allow-list de licencias
  se pobló a partir de la salida real de rechazo de la herramienta
  (MIT, Apache-2.0, MPL-2.0, Unicode-3.0, BSL-1.0, 0BSD, Zlib,
  Unlicense), no adivinada.
- **Hallazgo real durante el hardening (documentado, no producto)**:
  el fixture `hostile-content.html` inicial usaba `\t`/`\n` como texto
  literal en un atributo HTML (que HTML no interpreta como escape),
  por lo que el test de "javascript: con ofuscación por espacios en
  blanco" no ejercía lo que pretendía. Se corrigió embebiendo bytes de
  control reales en el HTML; una vez corregido, el sanitizador
  existente de P0 (`sanitize_href`) manejó correctamente el caso real
  sin necesidad de cambios de producto — el hallazgo era del test, no
  del código.
- **Falso positivo de aserción corregido**: el primer intento del test
  `final_markdown_strips_every_dangerous_url_but_keeps_all_safe_content`
  fallaba porque su aserción `!md.contains("javascript:")` coincidía
  con el TEXTO VISIBLE del enlace ("javascript: link", la etiqueta
  descriptiva del fixture), no con un href filtrado. Se corrigió a
  verificar el patrón real `](javascript:` (sintaxis de link Markdown).
- Tests de mensajes hostiles (`messages.test.js`): 20/20 — null,
  string, number, array, tipo desconocido, modo desconocido,
  `exportFormat` hostil, y un payload con forma de contaminación de
  prototipos (`__proto__`) que se confirmó NO contamina
  `Object.prototype` a través de este camino.
- `THIRD_PARTY_NOTICES.md` actualizado con el inventario transitivo
  completo generado por `cargo deny list` (77 dependencias, desglose
  de licencias real).
- Gate completo sin regresión: 95 tests Rust, 27 tests Node (7 lazy +
  20 messages), typecheck TS limpio.
- **Sin hallazgos críticos o altos sin documentar** — el único
  "hallazgo" real de esta fase fue un bug de fixture de test, ya
  corregido y documentado arriba.

## Historial

| Fecha      | Commits de código | Cambio                                                                                                                                                                                                                                                    |
| ---------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | `ec05773`         | Creación del spec P5                                                                                                                                                                                                                                      |
| 2026-09-17 | `88d7dfa`         | Hardening completo: cargo audit/deny instalados y en verde, fixture DOM hostil verificado en Chromium real (con un bug de fixture encontrado y corregido en el proceso), tests de mensajes hostiles/fuzzing, inventario de licencias transitivo generado. |
