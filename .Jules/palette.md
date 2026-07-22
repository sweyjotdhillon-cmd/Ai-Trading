## 2026-07-17 - Missing ARIA Labels on Icon-Only Pressable Modals
**Learning:** React Native Web `<Pressable>` components acting as icon-only close buttons in modals frequently lack `accessibilityLabel` and `accessibilityRole`. Without these, screen readers announce them poorly or not at all.
**Action:** When working on UI components using `<Pressable>` with icon-only content, always explicitly attach `accessibilityRole="button"` and a descriptive `accessibilityLabel` (e.g., "Close modal").
