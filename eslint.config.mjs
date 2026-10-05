// VideoOS monorepo ESLint 9 flat config.
// Scope: type-level hygiene on packages/ + apps/ (server, cli, agent, studio
// runtime-critical code). Studio .tsx is compiled by vite/tsc — here we run
// structural rules only (react-hooks) to stay fast in CI.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/build/**", "**/node_modules/**", "**/*.test.ts", "**/*.test.tsx", "apps/studio/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/studio/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
);
