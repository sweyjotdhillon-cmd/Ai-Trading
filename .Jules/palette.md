## 2024-05-24 - Accessibility labels on Pressable
**Learning:** Found several `<Pressable>` components missing `accessibilityRole` and `accessibilityLabel` which is important for screen reader support.
**Action:** Add `accessibilityRole="button"` and a descriptive `accessibilityLabel` to all icon-only `<Pressable>` components in the app.
