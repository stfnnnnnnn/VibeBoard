# Frontend Design Orchestrator

Coordinate the installed design skills to build distinctive, production-quality frontend interfaces.

Do not replace their instructions. Delegate to the right specialist at the right stage.

## 1. Scan First

Before designing or coding, inspect the relevant repository.

Understand:

* product, users, and primary flows
* framework and architecture
* existing pages and components
* design system, tokens, typography, and styling
* UI libraries and dependencies
* responsive and accessibility conventions
* relevant `CLAUDE.md`, `AGENTS.md`, README, and config files

Search before creating new components, tokens, patterns, or dependencies.

For large repositories, inspect strategically rather than reading everything.

Preserve what already works. Do not turn a targeted request into an unnecessary redesign.

## 2. Design Hierarchy

Use each skill for its specialty.

### `frontend-design` — Creative Direction

Use first for substantial new designs or redesigns.

Owns:

* visual concept
* composition and hierarchy
* typography and palette direction
* product-specific identity
* overall aesthetic direction

Establish **one coherent direction** and avoid generic AI/SaaS aesthetics.

### `ui-ux-pro-max` — UX & Design System

Use to systemize and validate the direction.

Owns:

* UX patterns
* design-system decisions
* spacing and typography systems
* component conventions
* responsive behavior
* accessibility guidance

It should support the creative direction, not replace it.

### `taste-skill` — Visual Critic

Use to challenge the design for:

* generic layouts
* weak hierarchy
* excessive cards/pills
* poor spacing or typography
* unnecessary decoration
* inappropriate density
* predictable AI aesthetics

Use its variance, motion, and density controls intentionally rather than maximizing them.

### Emil's Skills — Motion & Interaction

Invoke relevant skills only when needed for:

* animation
* transitions
* easing and timing
* micro-interactions
* state changes
* interaction refinement

Motion must communicate something. Do not animate for decoration alone.

### `impeccable` — Quality Gate

Use after implementation for relevant:

* critique
* audit
* layout
* typeset
* adapt
* harden
* polish

Use it to catch inconsistencies, accessibility problems, responsive issues, weak typography, fragile layouts, and unfinished details.

## 3. Workflow

For substantial frontend work:

**SCAN → DIRECT → SYSTEMIZE → BUILD → RENDER → CRITIQUE → POLISH**

1. Scan and understand the existing product.
2. Establish the visual direction with `frontend-design`.
3. Validate/systemize with `ui-ux-pro-max`.
4. Implement using existing architecture and primitives.
5. Render and inspect the actual interface when tooling allows.
6. Use `taste-skill` and relevant Emil skills where appropriate.
7. Finish with Impeccable critique/audit/polish.
8. Fix meaningful issues and verify again.

For small tasks, skip unnecessary stages.

Do **not** invoke all skills automatically.

## 4. Conflict Resolution

Priority:

**Product requirements > accessibility/usability > existing architecture > aesthetic preference**

Specialist ownership:

* Creative direction → `frontend-design`
* UX/system → `ui-ux-pro-max`
* Visual taste → `taste-skill`
* Motion → Emil
* Final QA → `impeccable`

When skills disagree, follow the specialist responsible for that domain instead of blending conflicting recommendations.

## 5. Implementation Rules

Prefer:

* existing components and tokens
* semantic and accessible UI
* reusable primitives
* maintainable styling
* existing dependencies

Avoid unnecessary:

* dependencies
* abstractions
* duplicated components
* arbitrary design tokens
* generic SaaS patterns
* excessive cards, pills, gradients, and rounded containers
* decorative animation

Distinctiveness must serve the product.

## 6. Verification

For substantial visual changes:

**IMPLEMENT → RENDER → INSPECT → FIX → RENDER AGAIN**

When possible, verify desktop, mobile, and an intermediate width.

Check hierarchy, typography, spacing, responsiveness, overflow, interaction states, accessibility, and reduced motion.

Never claim something was rendered, tested, or audited unless it actually was.

## Final Rule

The goal is **not to use all five skills**.

The goal is one coherent, product-specific interface.

Use the minimum specialists necessary, preserve context, and make the final result feel like one design team produced it.
