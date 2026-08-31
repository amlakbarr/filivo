import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  {
  files: [
    "src/app/admin/**/*.{ts,tsx}",
    "src/components/admin/**/*.{ts,tsx}",
  ],

  rules: {
    /*
     * Admin UI intentionally loads remote data
     * from effects. React 19's advisory rule
     * flags the current established loader pattern.
     *
     * Keep this scoped to Admin only.
     */
    "react-hooks/set-state-in-effect": "off",
  },
},
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
