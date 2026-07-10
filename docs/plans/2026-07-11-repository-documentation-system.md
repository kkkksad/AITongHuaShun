# Repository Documentation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a concise repository map and a structured, verifiable documentation system for KAIROS Quant.

**Architecture:** Keep `AGENTS.md` as a short task router and store detailed knowledge in topic-owned files under `docs/`. Separate current facts, product intent, architecture, operations, safety constraints, decisions, and time-bound plans so agents load only relevant context.

**Tech Stack:** Markdown, npm, React, TypeScript, Vite, Vitest

---

### Task 1: Record the repository's current facts

**Files:**
- Create: `docs/status/current-state.md`
- Modify: `README.md`

- [x] Inspect the root files and package configuration.
- [x] Confirm that `index.html` references `/src/main.tsx`.
- [x] Confirm that the current workspace does not contain `src/`.
- [x] Document the effect on development, tests, and builds.

### Task 2: Create the documentation map

**Files:**
- Create: `AGENTS.md`
- Create: `docs/README.md`

- [x] Add a concise project map and task-based routing.
- [x] Link every detailed topic to one authoritative document.
- [x] Record universal safety and verification constraints.

### Task 3: Split detailed knowledge by ownership

**Files:**
- Create: `docs/product/overview.md`
- Create: `docs/architecture/system-overview.md`
- Create: `docs/operations/development.md`
- Create: `docs/safety/trading-boundaries.md`
- Create: `docs/roadmap.md`

- [x] Move product scope out of the root README.
- [x] Distinguish current implementation from target architecture.
- [x] Record reproducible commands and known blockers.
- [x] Centralize data, backtest, permission, and order safety boundaries.

### Task 4: Preserve decisions and execution history

**Files:**
- Create: `docs/decisions/README.md`
- Create: `docs/decisions/0001-repository-as-record.md`
- Create: `docs/plans/README.md`
- Create: `docs/plans/2026-07-11-repository-documentation-system.md`

- [x] Record why the repository is the system of record.
- [x] Define decision and plan file conventions.
- [x] Verify internal links and inspect the final Git diff.

### Verification

Run:

```powershell
rg --files AGENTS.md docs README.md
rg -n "\]\([^)]*\.md\)" AGENTS.md README.md docs
git -c safe.directory='C:/Users/kjq/Desktop/AI量化' diff --check
```

Expected:

- All documented files are listed.
- Markdown links point to repository-owned documents.
- `git diff --check` reports no whitespace errors.

Actual results:

- 13 repository documentation files are present under `README.md`, `AGENTS.md`, and `docs/`.
- The link checker inspected 16 Markdown files, including pre-existing Markdown files, and found no broken local `.md` links.
- `AGENTS.md` contains 65 lines.
- `git diff --check` found no whitespace errors. Git reported only the expected Windows LF-to-CRLF conversion warning for `README.md`.
