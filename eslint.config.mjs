import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Ban inline `process.platform` comparisons. Turbopack's production minifier
  // constant-folds them to the BUILD machine's OS and dead-code-eliminates the
  // platform-specific branches — silently dropping Windows-only code from builds
  // made on macOS/Linux. A cross-module helper call (isWindows() etc.) is opaque
  // to that fold, so it stays a genuine runtime check. See src/lib/platform.ts.
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator=/^(===|!==|==|!=)$/] > MemberExpression[object.name='process'][property.name='platform']",
          message:
            "Don't compare process.platform inline — Turbopack const-folds it to the build OS and strips platform branches. Use isWindows() (or add isMac()/isLinux()) from @/lib/platform.",
        },
      ],
    },
  },
  {
    // The helper module is the one allowed place to read process.platform.
    files: ["src/lib/platform.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
