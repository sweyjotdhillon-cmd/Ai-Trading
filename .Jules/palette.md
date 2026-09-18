## 2024-03-24 - Accessibility Labels for Close/Dismiss Pressables
**Learning:** React Native Web `<Pressable>` components used for close buttons or dismiss actions, especially when relying on icon-only content (like `<X>` or `<XCircle>` from `lucide-react`), need explicit `accessibilityRole="button"` and `accessibilityLabel` props to be usable with screen readers.
**Action:** Always ensure that icon-only interactive elements in React Native (such as close buttons in Modals or error banners) are given descriptive accessibility labels and the correct button role.
