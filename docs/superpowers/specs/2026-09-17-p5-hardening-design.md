# P5 — Hardening: diseño

- Fecha: 2026-09-17
- Fase: P5 de P0–P6
- Estado: aprobado (continuación autorizada de todas las fases)

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

## Historial

| Fecha | Commits de código | Cambio |
|---|---|---|
| 2026-09-17 | (se completa al finalizar P5) | Creación del spec P5 |
