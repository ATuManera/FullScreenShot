# P0 — Foundation: diseño

- Fecha: 2026-09-17
- Fase: P0 (Foundation) de las fases P0–P6 definidas para FullScreenShot
- Estado: aprobado por el usuario (alcance P0, sin creación de repo GitHub todavía)

## Contexto

FullScreenShot es una extensión de navegador (Chrome/Edge/Safari) para capturas
full-page 100% locales, con un core de lógica en Rust compilado a WebAssembly y
un shell WebExtension mínimo en TypeScript. El proyecto se construye en fases
(P0–P6); este documento cubre únicamente **P0 — Foundation**, la base sobre la
que se apoyan todas las fases siguientes.

El proyecto nace vacío (directorio sin inicializar, sin git). El objetivo de
P0 no es funcionalidad de captura — eso es P1 — sino dejar en pie: workspace
Rust que compila con tests reales, documentación legal completa y correcta,
un shell de extensión MV3 que carga sin errores en Chrome, y CI básica.

## Alcance de P0

Incluido:

1. **Workspace Cargo** con 5 crates (`screenshot-core`, `screenshot-png`,
   `screenshot-pdf`, `screenshot-md`, `screenshot-wasm`), cada uno compilando
   con al menos un módulo con lógica real y tests reales (no placeholders
   vacíos). `screenshot-core::geometry` implementa los tipos y cálculos
   geométricos básicos (tiles, DPR, redondeo) con tests unitarios, porque es
   la base que P1 necesitará ampliar — el resto de módulos de `screenshot-core`
   (`capture_plan`, `tile`, `compositor`, `validation`) quedan como tipos/
   firmas mínimas con `error.rs` real, a completarse en P1–P3.
2. **Legal/licensing completo**: `LICENSE` (texto MPL-2.0 íntegro + Exhibit B),
   `AUTHORS.md`, `NOTICE.md`, `TRADEMARKS.md`, `THIRD_PARTY_NOTICES.md`,
   `SECURITY.md`, `PRIVACY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
   `CHANGELOG.md`, `README.md` inicial. Encabezados SPDX en archivos fuente
   propios.
3. **Shell WebExtension MV3 mínimo** (`extension/`): manifest base, background
   service worker, popup esqueleto (HTML/CSS/TS sin captura real todavía),
   browser abstraction layer (`extension/src/browser/`), y carga del módulo
   WASM compilado con una CSP restrictiva sin scripts remotos. Debe cargar
   sin errores en `chrome://extensions` (modo desarrollador, "Load unpacked").
4. **ADRs** relevantes a decisiones de P0: 0001 (Rust/WASM core), 0002
   (permisos de navegador), 0006 (licensing y atribución). Los ADRs 0003,
   0004, 0005 (estrategia de captura, compositor streaming, Markdown AST) se
   escriben en las fases donde se toman esas decisiones (P1–P3).
5. **CI básica** (GitHub Actions): `cargo fmt --check`, `cargo clippy
   --workspace --all-targets --all-features -- -D warnings`, `cargo test
   --workspace`, `cargo build --workspace`, build del crate WASM
   (`wasm32-unknown-unknown`), typecheck de TypeScript. No publica releases.
6. **Fixtures de test** (`tests/pages/`): se crean los 10 HTML de fixture
   listados en la sección 8 del prompt maestro, con contenido mínimo pero
   real (no vacíos) para que estén disponibles desde P1 en adelante.
7. **xtask**: interfaz de build mínima (`cargo xtask build`) que al menos
   compila el workspace; los subcomandos `test`/`package chromium`/`package
   safari` se amplían en fases posteriores conforme haya algo que empaquetar.

Explícitamente fuera de P0 (van en fases posteriores):

- Cualquier lógica de captura real (`captureVisibleTab`, scroll, stitching,
  rate limiter) — P1.
- Exportación PNG/PDF/Markdown funcional — P1/P3.
- Selected Scroll Area, lazy loading, modos Fast/Reliable — P2.
- Empaquetado y adaptador Safari — P4.
- `cargo audit` / `cargo deny`, hardening de seguridad — P5.
- Artefactos de distribución (`dist/`, `artifacts/`) — P6.
- **Creación del repositorio público en GitHub** — el usuario pidió
  explícitamente NO crear el repo todavía en este ciclo; el trabajo queda
  committeado localmente en `main` y listo para `git remote add` + push
  cuando el usuario lo confirme.

## Decisiones de diseño (resumen; detalle en ADRs)

- **Rust/WASM core + shell JS/TS mínimo** (no "todo Rust"): las WebExtension
  APIs solo existen en JS/TS; el core reutilizable y con lógica compleja
  (geometría, compositing, PDF, Markdown) vive en Rust → WASM. Ver ADR-0001.
- **Permisos mínimos MV3**: `activeTab`, `scripting`, `storage` únicamente en
  P0. Cualquier permiso adicional requiere justificación explícita en el ADR
  correspondiente cuando se necesite. Ver ADR-0002.
- **Licencia MPL-2.0 con "Incompatible With Secondary Licenses"** (Exhibit B)
  + separación estricta entre licencia de código (MPL) y marca/nombre
  (`TRADEMARKS.md`, sin licencia propietaria de marca). Ver ADR-0006.

## Gate de salida de P0 (criterios verificables)

- `cargo build --workspace` → sin errores.
- `cargo test --workspace` → todos los tests pasan (0 failed).
- `cargo fmt --check` → sin diferencias.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` →
  sin warnings.
- Build del crate `screenshot-wasm` a `wasm32-unknown-unknown` exitoso.
- `extension/` carga en `chrome://extensions` (Load unpacked) sin errores en
  la consola de la extensión.
- Todos los documentos legales/atribución existen y son consistentes entre sí
  (mismo nombre, mismo repo canónico, mismo año, mismo SPDX).
- `git log` muestra commits pequeños y temáticamente coherentes (sección 33).

## Historial

| Fecha | Commits de código | Cambio |
|---|---|---|
| 2026-09-17 | (pendiente, se completa tras implementar P0) | Creación inicial del spec P0 |
