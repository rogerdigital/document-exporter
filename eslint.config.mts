import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/formats/pdf.ts"],
    rules: {
      "import/no-nodejs-modules": "off",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      // Tests hand-polyfill Obsidian DOM globals in jsdom; the rule's
      // activeWindow.createDiv() suggestion does not type-check there.
      "obsidianmd/prefer-create-el": "off",
    },
  },
  globalIgnores([
    "node_modules",
    "dist",
    "src/**/*.js",
    "esbuild.config.mjs",
    "eslint.config.mts",
    "version-bump.mjs",
    "versions.json",
    "main.js",
  ]),
);
