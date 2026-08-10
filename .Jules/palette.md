
## 2024-07-24 - Missing accessibility attributes on icon-only `<Pressable>` components
**Learning:** Found multiple instances where icon-only `Pressable` components in React Native Web (specifically those used for closing modals, like `<X />` icons) did not have `accessibilityLabel` or `accessibilityRole="button"`. This makes them invisible or confusing to screen readers.
**Action:** When implementing or reviewing icon-only interactive elements, always ensure they have an `accessibilityLabel` describing their action and an `accessibilityRole="button"`.
