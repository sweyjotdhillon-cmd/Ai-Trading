## 2024-06-25 - Missing accessibility props on icon-only Pressable components
**Learning:** Icon-only `<Pressable>` components in React Native/react-native-web often lack the necessary accessibility props (`accessibilityLabel` and `accessibilityRole="button"`), which makes them unusable for screen reader users as they won't know the purpose of the button or that it's actionable.
**Action:** Always add `accessibilityRole="button"` and a descriptive `accessibilityLabel` to any icon-only interactive component (`<Pressable>`, `<TouchableOpacity>`).
