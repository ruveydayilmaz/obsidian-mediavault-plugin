import obsidianPlugin from "eslint-plugin-obsidianmd";

export default [
  ...obsidianPlugin.configs.recommended,

  {
    files: ["**/*.ts", "**/*.tsx"],

    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },

    rules: {
      "no-unused-vars": "off",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "none",
        },
      ],

      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  {
    files: ["src/shims/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "writable",
        globalThis: "readonly",
        self: "readonly",
        window: "readonly",
        document: "readonly",
        setTimeout: "readonly",
        MessageChannel: "readonly",
        MutationObserver: "readonly",
      },
    },
  },
];