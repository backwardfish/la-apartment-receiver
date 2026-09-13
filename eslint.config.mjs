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
    ".sites-runtime/**",
    ".netlify/**",
    ".wrangler/**",
    "next-env.d.ts",
  ]),
  {
    files: ["app/receiver-page.tsx"],
    // Netlify serves a static client; remote images are deliberately not proxied.
    rules: { "@next/next/no-img-element": "off" },
  },
]);

export default eslintConfig;
