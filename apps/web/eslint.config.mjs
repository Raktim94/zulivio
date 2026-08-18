import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  // FlatCompat doesn't carry over the implicit ignores `next lint` used to
  // apply — without this, a bare `eslint` invocation (this repo's `lint`
  // script) recurses into .next's compiled bundles and reports thousands of
  // false positives against minified build output. next-env.d.ts is
  // auto-generated/never hand-edited (its own header says so).
  { ignores: [".next/**", "node_modules/**", "out/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
