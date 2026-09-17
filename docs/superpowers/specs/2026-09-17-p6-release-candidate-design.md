# P6 — Release Candidate: diseño

- Fecha: 2026-09-17
- Fase: P6 de P0–P6 (última fase de este ciclo)
- Estado: aprobado (continuación autorizada de todas las fases)

## Contexto

P0–P5 dejaron una extensión funcional (Chrome/Edge, PNG/PDF/Markdown),
Safari preparado hasta el límite del entorno, y una pasada de seguridad
real. P6 no añade funcionalidad: produce los artefactos finales y verifica,
uno por uno, los criterios de aceptación del MVP (sección 35 del prompt
maestro).

## Alcance de P6

1. `dist/chromium/` regenerado desde cero vía `cargo xtask build`.
2. `artifacts/fullscreen-shot-chromium-0.1.0.zip` regenerado vía
   `cargo xtask package chromium`.
3. `dist/safari/`: no producible en este entorno (sin Xcode completo,
   documentado en P4) — se deja constancia explícita, no se simula.
4. Verificación explícita, uno por uno, de los criterios de aceptación
   de la sección 35 del prompt maestro, con evidencia real (no "debería
   funcionar" sino comando + resultado).
5. Revisión final del árbol del repositorio (sección 39): sin tokens,
   passwords, API keys, claves privadas, `.env` reales, `node_modules`
   versionado, `target` versionado, basura de build, capturas con datos
   personales.
6. `git status` limpio salvo razón documentada.
7. Informe final (sección 40) con todo lo anterior.

Explícitamente fuera de P6: publicación en Chrome Web Store, Edge
Add-ons, o Apple App Store. Push al repositorio remoto de GitHub — el
usuario pidió explícitamente decidir eso por separado ("después veremos
el primer push").

## Gate de salida de P6

- Los tres artefactos/estados de `dist/`+`artifacts/` existen o están
  explícitamente documentados como no producibles, con la razón exacta.
- Cada ítem de la sección 35 tiene una marca real (cumplido / no
  aplica-por-qué / pendiente-de-verificación-manual-por-qué), no una
  afirmación genérica.
- `git status` limpio.
- Sin secretos ni basura en el árbol versionado.

## Historial

| Fecha | Commits de código | Cambio |
|---|---|---|
| 2026-09-17 | (se completa al finalizar P6) | Creación del spec P6 |
