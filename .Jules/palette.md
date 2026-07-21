## 2026-07-03 - Missing accessibility properties on icon-only Pressable components
**Learning:** In React Native Web, icon-only `<Pressable>` components must include `accessibilityLabel` and `accessibilityRole="button"` props to ensure they are accessible to screen readers, as the icon components themselves do not inherently provide semantic meaning.
**Action:** When adding or reviewing icon-only interactive components, explicitly check for and add `accessibilityLabel` with a descriptive action (e.g., 'Close settings') and `accessibilityRole="button"`.
