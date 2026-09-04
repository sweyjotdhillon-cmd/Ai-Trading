## 2024-05-14 - Missing ARIA labels on modals
**Learning:** Found several icon-only `<Pressable>` components in settings and user profile modals (like "Close" and "Back" buttons) that lack `accessibilityLabel` and `accessibilityRole="button"`, hindering screen reader navigation.
**Action:** Always verify icon-only buttons in modals and overlays have proper `accessibilityLabel` describing the action, along with `accessibilityRole="button"`.
