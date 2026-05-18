import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "src/data/pricing.json",
    ],
  },
  {
    rules: {
      // We use 'any' deliberately for fast-evolving Google API response shapes.
      // Will tighten with proper Zod schemas post-hackathon.
      "@typescript-eslint/no-explicit-any": "off",
      // Allow underscore-prefixed unused args (e.g. _req in handlers).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
