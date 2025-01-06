import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";

export default [
  js.configs.recommended,
  {
    plugins: {
      "@stylistic": stylistic,
    },
    rules: {
      "@stylistic/semi": "error",
      "no-undef": "off", // TypeScript handles this
      "no-unused-vars": "off" // TypeScript handles this
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
      },
      globals: {
        Buffer: "readonly",
        console: "readonly",
        // Add Jest globals
        jest: "readonly",
        expect: "readonly",
        describe: "readonly",
        it: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        // Add Node.js globals
        module: "readonly",
        require: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
];
