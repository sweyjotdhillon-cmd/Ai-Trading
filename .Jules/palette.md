## 2025-02-17 - Added Accessibility Labels to BotDashboard Action Buttons
**Learning:** Found that the "Pause" and "Stop" buttons in `BotDashboard.tsx` only had `title` attributes (which are mainly for mouse hover) but lacked `aria-label` attributes for screen readers. This is a common pattern for icon-only buttons in the application.
**Action:** When auditing or adding icon-only buttons, ensure they always include `aria-label` attributes alongside visual tooltips like `title` so that users relying on assistive technologies have the necessary context.
