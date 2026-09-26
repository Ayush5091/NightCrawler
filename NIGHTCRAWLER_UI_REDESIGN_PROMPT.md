# NightCrawler — In-Place Material You UI Redesign Prompt

<role>

You are an expert frontend engineer, UI/UX designer, visual design specialist, motion designer, accessibility specialist, and typography expert.

Your task is to redesign the existing NightCrawler dashboard in place. The product and its functionality already exist; the current interface is visually weak and needs a coherent Material You (Material Design 3) presentation layer. Treat this as a careful frontend modernization, not as a greenfield landing page and not as a content rewrite.

Repository: https://github.com/Ayush5091/NightCrawler

The outcome should feel friendly, tactile, expressive, data-rich, and highly polished while remaining fast and practical for repeated dashboard use.

</role>

<project-reality>

Before writing code, inspect the repository and verify these assumptions against the current branch:

- The backend is Node.js + TypeScript and uses a small native HTTP server.
- The existing frontend is plain HTML, CSS, and JavaScript in `web/index.html`, `web/style.css`, and `web/app.js`.
- There is currently no React, Vite, Tailwind, shadcn/ui, or component framework.
- The server exposes scan APIs under `/api/scans` and currently serves the frontend directly.
- The current interface is an application dashboard, not a marketing site.
- Existing Playwright smoke tests depend on functional behavior and some stable selectors.

Do not pretend Framer Motion can be added directly to the current vanilla DOM implementation. Framer Motion is React-specific. If both Framer Motion and GSAP are required, migrate only the presentation layer to React + TypeScript + Vite while keeping the Node crawler, scan logic, saved data, API routes, and response contracts intact.

The preferred architecture is:

- Existing Node/TypeScript crawler and API: unchanged unless a small static-asset serving adjustment is necessary.
- New React + TypeScript frontend: replaces only the contents of the current `web` presentation layer.
- Vite: build tooling for the React frontend.
- Framer Motion: component-level and state-driven motion.
- GSAP + ScrollTrigger: reserved for complex, scroll-linked choreography that Framer Motion should not own.
- Central CSS custom properties: the single source of truth for Material You design tokens.

Do not introduce Tailwind, shadcn/ui, or another component library unless the existing branch already contains it or there is a concrete, documented reason. Avoid unnecessary dependencies and avoid turning this focused dashboard into a framework showcase.

</project-reality>

<primary-objective>

Fix the current UI while preserving its content structure, feature set, and information architecture.

Preserve all existing sections and their meaning:

1. Sidebar navigation and product identity
2. Dashboard introduction/header
3. Website scan form
4. Scan status and progress feedback
5. Latest report heading and export actions
6. Overview metrics
7. Lighthouse scores
8. Resource mix
9. Performance snapshot
10. DNS and infrastructure
11. TLS certificate
12. Optimization opportunities
13. Data flows
14. Detected data fields
15. Unknown destinations
16. Cookies and browser storage
17. Consent observations
18. Network timeline
19. Technologies and vendors
20. Page inventory
21. Findings
22. Scan history and comparison
23. Existing privacy/disclosure footer

Do not remove, rename, fabricate, or materially reorder product content merely to make the layout easier to style. You may improve grouping, responsive placement, hierarchy, whitespace, labels, and progressive disclosure as long as users can still locate the same information and complete the same tasks.

Preserve:

- All API endpoints and payload shapes.
- Scan creation, polling, demo report, history, comparison, upload, and export behavior.
- Input validation and upload limits.
- Existing security and privacy behavior.
- Useful IDs, roles, labels, and selectors relied upon by tests; if a selector must change, update the tests in the same change.
- Semantic HTML and keyboard access.

Do not rewrite backend crawling or analysis logic as part of a visual redesign.

</primary-objective>

<discovery-and-planning>

Before changing code:

1. Inspect `package.json`, `web/index.html`, `web/style.css`, `web/app.js`, `src/server.ts`, and the UI smoke tests.
2. Build a concise model of the current stack, component boundaries, data flow, selectors, CSP constraints, responsive behavior, and known technical debt.
3. Inventory the current content and interactions so no feature disappears during migration.
4. Identify which elements should become reusable components and which should remain simple composition.
5. Present a short implementation plan before editing.

The scope is already defined as a full in-place UI modernization. Do not stop to ask whether the user wants a single component, a page, or the whole interface. Ask a focused question only if a genuine product decision cannot be inferred from the repository and would materially change the result.

</discovery-and-planning>

<component-architecture>

Use a small, maintainable component system instead of one monolithic dashboard component. Follow the repository's naming conventions where possible. A sensible starting point is:

- `AppShell`
- `SidebarNavigation`
- `DashboardHeader`
- `ScanForm`
- `ScanStatus`
- `ReportHeader`
- `SectionHeader`
- `MetricCard`
- `ScoreCard`
- `DataCard`
- `DataTable`
- `StatusChip`
- `EmptyState`
- `FindingItem`
- `HistoryTable`

Keep data formatting, escaping/safe rendering, API access, polling, and report mapping separate from visual primitives. Prefer typed props and small formatting helpers. Avoid premature abstraction, prop explosion, and one-off wrapper components that add no clarity.

Centralize design primitives in tokens and reusable components. Do not scatter raw hex values, transition curves, radii, or shadow definitions throughout component files.

</component-architecture>

<design-system>

Use Material You / Material Design 3 with a purple-violet seed and a refined data-dashboard interpretation.

## Personality

- Personal, adaptive, soft, rounded, colorful, confident, and highly legible.
- Tonal surfaces create hierarchy; heavy borders and dramatic drop shadows do not.
- The interface should be expressive without becoming toy-like or reducing information density.
- The hero/header can carry the strongest atmospheric treatment. Data tables and analysis areas should remain calm and easy to scan.

## Core color tokens

- Background / surface: `#FFFBFE`
- On surface: `#1C1B1F`
- Primary: `#6750A4`
- On primary: `#FFFFFF`
- Primary container: derive an accessible light violet tone
- On primary container: derive a dark violet tone
- Secondary container: `#E8DEF8`
- On secondary container: `#1D192B`
- Tertiary: `#7D5260`
- Surface container: `#F3EDF7`
- Surface container low/recessed: `#E7E0EC`
- Outline: `#79747E`
- On surface variant: `#49454F`
- Error and success tones: define accessible MD3-compatible semantic tokens rather than hard-coded component colors

Never use pure white as a page or card background. White is allowed only where the design system specifically calls for on-color text or controlled translucent state layers.

## Typography

- Use Roboto in weights 400, 500, and 700 to follow the requested Material You direction.
- Prefer self-hosted font assets or another CSP-compatible approach because the current server uses a restrictive Content Security Policy.
- Do not silently weaken CSP just to load Google Fonts.
- Use a clear MD3-inspired type scale with responsive `clamp()` values.
- Headings: medium weight, tight but readable tracking, balanced line wrapping.
- Body and data text: high legibility, relaxed line height, and sensible measure.
- Tables may use tabular numerals for metrics and timings.

## Radius

- Buttons, chips, badges: pill-shaped (`9999px`).
- Compact controls: 8–12px.
- Standard cards: 24px.
- Prominent cards: 28–32px.
- Header/major container: 32–48px on desktop, reduced thoughtfully on mobile.

## Elevation and depth

- Default cards: tonal separation first, soft elevation second.
- Interactive cards: subtle shadow at rest, medium shadow and restrained lift on hover.
- Important containers: layered tonal background plus soft, diffuse shadow.
- Avoid high-contrast black shadows.

## Inputs

Use the Material 3 filled text-field model:

- Surface-container-low background.
- Rounded top corners and visually quieter bottom corners.
- A 2px bottom indicator that changes to primary on focus.
- Clear visible labels; never rely only on placeholders.
- Minimum 44px touch target and clear error/disabled states.

## Tables and dense data

- Preserve data density and readability.
- Use calm tonal row separation, sticky headers where useful, readable column alignment, and clear horizontal-overflow affordances.
- Do not turn every row into a large card on desktop.
- On narrow screens, choose intentional horizontal scrolling or prioritized column layouts rather than crushing content.
- Keep essential values readable without requiring animation.

## Atmospheric signature

Use layered organic blur shapes, soft radial washes, and restrained glass effects around the dashboard header, scan panel, and select overview areas. Decorative shapes must be `aria-hidden`, non-interactive, and unable to obscure text or data.

The signature moment should be the transition from an idle scan panel into a populated intelligence report: status feedback resolves into a composed overview with staggered metric reveal and a subtle, purposeful data-flow motif. It must not delay access to results.

</design-system>

<motion-system>

Motion is part of the interface architecture, not decoration added at the end.

## Division of responsibility

Use Framer Motion for:

- Initial shell and section reveals.
- Staggered metric-card entrances.
- `AnimatePresence` for status, loading, error, and report state changes.
- Layout transitions when reports appear or cards change.
- Button, chip, card, and navigation hover/tap feedback.
- Collapsible details and mobile navigation.
- Small number/count emphasis that remains understandable without motion.

Use GSAP + ScrollTrigger only for:

- The hero/background atmospheric choreography.
- A restrained, scroll-linked data-flow visualization or section-progress treatment.
- Complex timelines that genuinely require precise sequencing or pinning.

Do not use GSAP for ordinary button hover states, and do not use Framer Motion and GSAP to animate the same element or CSS property. Every animated element must have one owner.

## Motion rules

- Standard easing: `cubic-bezier(0.2, 0, 0, 1)` or an equivalent spring tuned to feel similarly confident.
- Micro-interactions: approximately 160–220ms.
- Card and surface transitions: approximately 240–320ms.
- Large choreography: remain under 700ms unless scroll-controlled.
- Animate `transform` and `opacity` wherever possible.
- Avoid animating layout-heavy properties such as `width`, `height`, `top`, `left`, and large filters during scroll.
- Use scale feedback sparingly: tap/press near `0.97`, not an exaggerated bounce.
- Hover effects must be behind hover-capable media queries so touch devices do not receive sticky hover behavior.
- Do not use scroll hijacking.
- Do not pin long data sections or make information dependent on a scroll animation completing.
- Register GSAP plugins once and clean up animations with `gsap.context()` or equivalent component lifecycle cleanup.
- Lazy-load GSAP/ScrollTrigger if it is not needed for first paint.
- Avoid duplicate React renders or hydration/layout shifts caused by animation setup.

## Reduced motion

Respect `prefers-reduced-motion` at both CSS and JavaScript levels:

- Use Framer Motion's reduced-motion support.
- Disable ScrollTrigger timelines, parallax, translation, and scale effects when reduced motion is requested.
- Preserve state changes with immediate updates or very short opacity transitions.
- Ensure all information and actions remain available without animation.

</motion-system>

<interaction-details>

- All standard buttons are pill-shaped and have hover, focus-visible, active, loading, and disabled states.
- All clickable elements receive tactile press feedback without shifting surrounding layout.
- Use state-layer opacity changes instead of unrelated hue swaps.
- Use a visible 2px primary focus ring with a clear offset.
- Minimum interactive target: 44×44px.
- Replace decorative emoji/symbol UI with a consistent accessible SVG icon set or custom inline SVGs. Icon-only controls require accessible names.
- Do not implement a custom cursor.
- Add a branded text-selection style that retains contrast.
- Loading, empty, error, and unavailable states must be designed, not left as raw text.
- Scan progress must remain polite for screen readers via appropriate live-region behavior.

</interaction-details>

<responsive-behavior>

- Desktop: persistent sidebar and wide data layouts.
- Tablet: compact sidebar or controlled navigation rail; two-column cards collapse based on available space.
- Mobile: accessible top app bar/drawer, single-column overview cards, usable scan form, and explicit table overflow.
- Major radii and spacing scale down on smaller screens without losing the Material You character.
- Test at approximately 1440px, 1024px, 768px, and 390px widths.
- Do not hide core dashboard functionality on smaller screens.

</responsive-behavior>

<accessibility-and-performance>

- Meet WCAG 2.2 AA contrast for text, controls, focus indicators, and meaningful chart elements.
- Preserve logical heading order, landmarks, form associations, table semantics, and keyboard navigation.
- Do not rely on color alone to communicate Lighthouse score, scan state, severity, or comparison results.
- Maintain usable contrast inside translucent/glass surfaces.
- Keep LCP under 2.5 seconds where practical and avoid CLS.
- Target smooth 60fps interactions on a normal laptop and a mid-range mobile device.
- Avoid permanent `will-change`; apply it only where needed and remove it after motion.
- Do not animate hundreds of table rows. Animate the container or a small visible subset.
- Prefer CSS for simple state transitions; use motion libraries only where they add real value.
- Keep the bundle proportionate to a local dashboard. Tree-shake and code-split animation libraries where possible.

</accessibility-and-performance>

<implementation-sequence>

1. Audit the existing UI, functionality, selectors, API flow, and CSP.
2. Propose a concise migration and component plan.
3. Create centralized design tokens and global foundations.
4. Build reusable primitives and the responsive app shell.
5. Move existing scan/report behavior into typed React modules without changing API contracts.
6. Recreate every existing dashboard section with the same content and functionality.
7. Add Framer Motion micro-interactions and state transitions.
8. Add only the GSAP/ScrollTrigger sequences that pass the purpose and performance tests.
9. Add reduced-motion fallbacks and accessibility refinements.
10. Update static asset serving and CSP only as narrowly as required by the new build.
11. Update tests only where implementation details necessarily changed; keep behavioral coverage.
12. Verify desktop and mobile visually and functionally.

</implementation-sequence>

<verification>

Before declaring the work complete:

- Install dependencies and ensure the lockfile is updated.
- Run TypeScript type checking.
- Run the existing smoke tests.
- Run the dashboard and open the demo report in Playwright.
- Confirm there are no browser console errors, failed local assets, or unhandled promise rejections.
- Verify scan form submission, loading/polling, demo report, exports, history opening, and comparison behavior.
- Capture and inspect screenshots at desktop and mobile widths.
- Confirm keyboard navigation and visible focus states.
- Confirm reduced-motion behavior.
- Confirm tables remain usable on mobile.
- Confirm backend crawler and API behavior were not unintentionally changed.

Report what changed, the architectural decisions made, commands run, and any remaining limitations. Do not claim completion if the build or tests are failing.

</verification>

<anti-patterns>

Do not:

- Replace the dashboard with a generic SaaS landing page.
- Invent marketing copy, testimonials, pricing, blog cards, or unrelated sections.
- Remove dense information merely to create more whitespace.
- Use pure white page/card backgrounds or pure black body text.
- Apply large blur effects behind tables where they harm readability.
- Animate every row or number continuously.
- Use both motion libraries for the same job.
- Add ScrollTrigger simply because it is installed.
- block interaction during entrance animations.
- break deep links/section navigation.
- weaken Content Security Policy without a documented necessity.
- change API contracts during a visual redesign.
- introduce Tailwind, shadcn/ui, or a broad component library without justification.
- leave one-off colors, radii, shadows, or easing values scattered through components.
- sacrifice accessibility or performance for visual novelty.

</anti-patterns>

<definition-of-done>

The redesign is complete when NightCrawler retains the same content structure and capabilities, but the interface now reads as one coherent Material You system; feels responsive and tactile; uses Framer Motion and GSAP with disciplined, non-overlapping responsibilities; works across desktop and mobile; respects reduced motion; passes the relevant tests; and leaves the frontend architecture cleaner and easier to extend than before.

</definition-of-done>
