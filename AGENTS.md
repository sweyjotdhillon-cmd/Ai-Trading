# AGENTS.md

> **Purpose:** This file is the operational playbook for any AI/code agent working in this repository.  
> It defines what the app does, goals, standards, workflows, constraints, and quality bars so contributions are consistently high-value, safe, and production-ready.

---

## 0) About ChartLens (Project Context)

**What it is:** ChartLens is a **100% offline, real-time live camera feed chart analyzer** tailored for professional day traders. It captures chart images via camera/screen, processes them locally, and generates rule-based trading signals deterministically.

**Technology Stack:**
- **Frontend Core:** React, React Native (for UI primitives), TypeScript, Vite.
- **Styling:** Tailwind CSS integrated via the `twrnc` library for React Native compatibility.
- **Concurrency:** Extensive use of **Web Workers** (`src/workers/`) to keep the main UI thread perfectly responsive while heavy analysis runs in the background.

**Architecture & Repository Structure:**
- `src/vision/`: Handles image processing, machine vision, OCR, and chart axis extraction.
- `src/quant/`: Contains the core quantitative trading signal logic (rule engine, stability filters, mathematical indicators). **Critical Note:** For performance-sensitive operations here, explicitly use and return `Float64Array` instead of standard `number[]` arrays to avoid unnecessary memory allocations.
- `src/workers/`: Web Worker scripts executing the vision -> quant pipeline off the main thread.
- `__tests__/`: Unit tests are collocated in `__tests__` subdirectories relative to the source code being tested (e.g., `src/vision/__tests__/`).

**Development Commands:**
- `npm run dev`: Start local dev server via Vite.
- `npm run build`: Build for production.
- `npm run start` / `npm run preview`: Serve production build locally.
- `npx vitest run`: Execute the testing suite.
- `npm run lint`: Run ESLint.
- `npx tsc --noEmit`: Run Type Checking.

---

## 1) Mission & Operating Principles

You are operating in a trading-focused codebase where **correctness, traceability, and risk-awareness** matter more than speed.

### Core principles
1. **Safety first**: avoid changes that could introduce hidden trading, financial, or data risks.
2. **Determinism over cleverness**: prefer explicit, readable logic over fragile abstractions.
3. **Small, verifiable increments**: ship focused diffs with clear intent and measurable outcomes.
4. **Evidence-based changes**: justify decisions with code context, test output, and reproducible checks.
5. **Respect existing architecture**: extend patterns already used in the repository unless a better design is clearly justified.

---

## 2) Scope of Agent Responsibilities

When asked to implement a task, the agent should:

- Understand the user’s explicit objective and implicit constraints.
- Inspect relevant code paths before modifying anything.
- Propose or execute the smallest complete solution that satisfies requirements.
- Validate behavior with local checks.
- Communicate what changed, why, and how it was verified.

If requirements are ambiguous, make conservative assumptions and document them in the final summary.

---

## 3) Repository Familiarization Checklist (Before Editing)

Before writing code, perform this quick orientation:

1. Identify stack and tooling from `package.json`, config files, and README.
2. Find the feature’s entry points (UI, hooks, services, utility modules, config).
3. Identify type definitions and shared contracts affected by the change.
4. Determine how the feature is currently tested (unit/integration/manual).
5. Note any lint/type/test commands relevant to the scope.

---

## 4) Code Quality Standards

### 4.1 Readability
- Use descriptive naming (avoid ambiguous abbreviations).
- Keep functions focused; separate concerns.
- Prefer guard clauses over deeply nested conditionals.
- Add concise comments only where intent is not obvious from code.

### 4.2 Type Safety (TypeScript)
- Avoid `any` unless absolutely unavoidable and clearly justified.
- Reuse existing domain types where possible.
- Add or refine types when touching untyped boundaries.
- Keep null/undefined handling explicit.

### 4.3 State & Data Flow
- Minimize implicit coupling between components/modules.
- Keep state transitions predictable and localized.
- Avoid side effects in render paths.
- Ensure async flows handle loading/error states intentionally.

### 4.4 Error Handling
- Fail safely with actionable messages.
- Do not swallow errors silently.
- Preserve useful debugging context without leaking secrets.

### 4.5 Performance
- Avoid unnecessary re-renders and repeated expensive calculations.
- Memoize only where it materially improves behavior.
- Keep bundle impact reasonable; avoid adding dependencies without strong need.

---

## 5) Trading & Risk-Aware Engineering Guardrails

Because this project relates to trading workflows, apply these guardrails rigorously:

1. **No accidental execution pathways**: UI or logic changes must not unintentionally trigger live actions.
2. **Explicit environment behavior**: clearly separate test/simulated vs production/live behavior.
3. **Numerical caution**: be deliberate with rounding, precision, percentage math, and currency formatting.
4. **Time handling discipline**: treat timezones, timestamps, and intervals consistently.
5. **Data provenance clarity**: preserve source-of-truth boundaries between computed vs fetched values.
6. **Risk defaults**: when uncertain, default to non-destructive and conservative behavior.

---

## 6) Change Management Rules

### 6.1 Keep Diffs Focused
- Do not perform broad refactors unless requested or required to safely implement the feature.
- Avoid incidental churn (formatting-only edits across unrelated files).

### 6.2 Backward Compatibility
- Maintain existing behavior unless change is explicitly requested.
- If behavior changes, document old vs new behavior in summary.

### 6.3 Dependency Policy
- Do not add new dependencies unless necessary.
- If added, explain why native/project-local alternatives were insufficient.

---

## 7) Testing & Validation Protocol

For every non-trivial change, run relevant checks (as available):

1. **Type checks** (e.g., `tsc` / project equivalent)
2. **Lint**
3. **Unit/integration tests** in affected scope
4. **Build verification** when UI/runtime behavior is impacted

If any check cannot be run, state:
- what was attempted,
- why it could not run,
- what residual risk remains.

---

## 8) Documentation & Communication Standards

When delivering work, include:

1. **Summary of changes** (what and where)
2. **Reasoning** (why approach was chosen)
3. **Validation results** (exact commands + outcomes)
4. **Known limitations or follow-ups**

Be precise and concise. Prefer bullet points over long prose.

---

## 9) Security, Privacy, and Secrets

- Never hardcode secrets, API keys, tokens, or credentials.
- Do not log sensitive information.
- Respect `.env` conventions and existing config boundaries.
- Minimize data exposure in client-visible code.

---

## 10) File & Architectural Hygiene

- Place new code in the most semantically appropriate module.
- Reuse existing utilities before creating new ones.
- Keep public interfaces minimal and intentional.
- If introducing a new pattern, include a short rationale in PR notes.

---

## 11) Agent Execution Blueprint (Practical Workflow)

Use this exact sequence for most tasks:

1. **Clarify objective** (extract success criteria from prompt).
2. **Inspect code** (locate impacted files and dependencies).
3. **Plan minimally** (define smallest complete implementation).
4. **Implement** (make focused edits).
5. **Self-review** (logic, types, edge cases, regressions).
6. **Validate** (run relevant checks/tests).
7. **Report** (clear summary + test evidence + caveats).

---

## 12) Preferred Decision Heuristics

When multiple approaches are viable, prefer in this order:

1. Existing project pattern
2. Simpler implementation with clear semantics
3. More testable design
4. Lower operational risk
5. Higher extensibility

---

## 13) Definition of Done (DoD)

A task is done when all are true:

- Requirements are satisfied completely.
- Changes are scoped and coherent.
- Type/lint/tests relevant to scope pass (or failures are transparently documented).
- No obvious regressions introduced.
- Final summary enables a reviewer to validate quickly.

---

## 14) Anti-Patterns to Avoid

- Unrequested large refactors.
- Hidden behavior changes.
- Overuse of `any`, non-null assertions, or type casts.
- Catch-all error handling that discards context.
- Business logic embedded in UI components when it belongs in utilities/services.
- “Magic numbers” without explanation.

---

## 15) Quick PR Quality Checklist (Agent Self-Gate)

Before concluding, confirm:

- [ ] Diff is directly tied to the request.
- [ ] No secrets or sensitive data introduced.
- [ ] Types are sound and explicit.
- [ ] Edge cases and failure states considered.
- [ ] Validation commands executed and results captured.
- [ ] Final write-up is reviewer-friendly.

---

## 16) Default Tone & Collaboration Style

- Be direct, professional, and practical.
- Prefer concrete recommendations over generic advice.
- Flag risks early; do not bury caveats.
- Optimize for maintainers who must operate this system later.

---

**End of AGENTS.md**
