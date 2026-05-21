# FIX NOTES: ActivityIndicator runtime crash in production

## What was wrong
- `src/components/LiveAnalysis.tsx` had split import blocks with runtime code between them, which can break ESM import evaluation order under production bundling/minification.
- `ActivityIndicator` relied on a destructured named import from `react-native`, which is occasionally brittle with RNW/CJS-ESM interop in production builds.
- Vite config did not explicitly prebundle `react-native-web` and did not enable mixed ESM transforms for CJS paths.
- A committed `dist/` artifact risked stale deploy assets being served.

## What changed
1. Reordered all imports in `LiveAnalysis.tsx` so every import is at the top before any runtime code.
2. Added resilient namespace fallback in both components:
   - `import * as RN from 'react-native'`
   - `const ActivityIndicator = RN.ActivityIndicator`
   - Removed `ActivityIndicator` from destructured react-native imports.
3. Hardened Vite build/deps behavior:
   - Added `optimizeDeps.include = ['react-native-web']` and `esbuildOptions.mainFields`.
   - Added `build.commonjsOptions.transformMixedEsModules = true`.
4. Added `errorStack` rendering in `TerminalErrorBoundary` (first 400 chars) for quicker production diagnosis.
5. Removed tracked `dist/` artifacts and ensured `dist/` is ignored.

## Why each change is necessary
- Top-level import ordering guarantees standards-compliant module initialization and avoids production-only symbol breakage.
- Namespace import fallback avoids fragile named-binding interop edge cases and keeps `ActivityIndicator` resolvable at runtime.
- Vite hardening improves consistency between dev/prod module resolution and CJS interop paths.
- Removing stale build output prevents accidental deployment of old broken bundles.
- Surface stack traces in boundary UI so future prod crashes are actionable immediately.

## How to verify locally
1. `npm run build`
2. `npm run preview` and open the preview URL, pass Hero intro, launch terminal, ensure LiveAnalysis renders (spinner visible where applicable) without boundary crash.
3. `npm test`
