# ADR-0006: MPL-2.0 (Incompatible With Secondary Licenses) + separate trademark policy

## Status

Accepted (P0)

## Context

FullScreenShot is released as open source under the ATuManera
organization, authored by Fernando Gallarday. The project needs a
license that: is genuinely open-source, is compatible with a wasm32
Rust dependency graph, and protects the project's name/attribution
from being reused misleadingly by forks — without turning the *code*
license into something non-open-source.

## Decision

License all project-owned source under MPL-2.0, with the "Incompatible
With Secondary Licenses" notice (Exhibit B) applied, recorded in full
in `LICENSE`. Keep trademark/name protection entirely separate from
the code license: `TRADEMARKS.md` documents that MPL-2.0 grants no
brand rights, and that forks may not present themselves as official
ATuManera/Fernando Gallarday releases without authorization, while
remaining free to fork, modify, and redistribute the code itself.
Attribution to the original project/author is treated as a legal
notice (`NOTICE.md`, `AUTHORS.md`, an in-extension About screen), not
as advertising.

## Alternatives considered

- **MIT/Apache-2.0 dual license:** rejected — permissive but offers no
  file-level copyleft-notice mechanism comparable to MPL's per-file
  approach, and the project owner specifically wants the "Incompatible
  With Secondary Licenses" declaration.
- **A custom "source available" or proprietary-branding license:**
  rejected — would make the project not genuinely open-source, which
  contradicts the project's stated non-negotiable principle
  (`Open source.` in the top-level goals).

## Consequences

- Every project-owned source file should carry the SPDX header
  `SPDX-License-Identifier: MPL-2.0-no-copyleft-exception`.
- Third-party dependencies keep their own licenses, tracked in
  `THIRD_PARTY_NOTICES.md`; MPL-2.0 is file-level copyleft, so
  unmodified MIT/Apache-2.0 dependencies used as-is impose no
  additional obligations beyond their own notices.
- Any fork is legally free to use the code under MPL-2.0 but is asked,
  per `TRADEMARKS.md`, not to claim official status without
  authorization — this is a social/legal-attribution norm, not a
  code-license restriction.
