## 2023-10-27 - [Add accessibilityLabel to Reload button]
**Learning:** Found a missing `accessibilityLabel` in the `<Pressable>` element within `src/App.tsx`. Because `Pressable` behaves like a native button, accessibility labels are required for screen readers. Added `accessibilityRole="button"` as well as `accessibilityLabel="Reload application"`.
**Action:** Always check `Pressable` components in React Native / `react-native-web` environments to ensure they have appropriate accessibility roles and labels, especially those that consist only of an icon and no text.
