
## 2024-05-18 - Added Accessibility Labels to Modal Close Buttons
**Learning:** Found a recurring pattern where `<Pressable>` components used solely for icon-only actions (like close buttons) lacked the necessary `accessibilityRole` and `accessibilityLabel` properties, potentially impeding usability for users relying on screen readers.
**Action:** Always ensure that interactive UI elements, particularly icon-only buttons like `<Pressable>` in React Native Web, explicitly specify `accessibilityRole="button"` and provide a descriptive `accessibilityLabel` (e.g., "Close settings", "Close profile") to comply with accessibility standards.
