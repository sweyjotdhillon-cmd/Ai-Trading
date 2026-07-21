## 2024-07-25 - Missing ARIA attributes on icon-only Pressable components
**Learning:** React Native's `<Pressable>` component when used strictly with an icon (like `<X />` for a close button) lacks context for screen readers in this codebase.
**Action:** Always add `accessibilityLabel="Description"` and `accessibilityRole="button"` props to icon-only `<Pressable>` components to ensure basic keyboard and screen reader accessibility.
