
## 2024-05-29 - [Accessibility] Missing ARIA labels on Icon-Only Pressables
**Learning:** In this React Native Web application, many small auxiliary close/dismiss buttons (like modal exits or notice dismissals) are built using `<Pressable>` components containing only an `<X>` icon. These buttons often lack the necessary `accessibilityRole="button"` and `accessibilityLabel="..."` attributes, rendering them inaccessible to screen readers which will just read them as generic pressable elements without context.
**Action:** Always check icon-only `<Pressable>` elements across the codebase and add `accessibilityRole="button"` and descriptive `accessibilityLabel` attributes to ensure they are screen-reader friendly.
