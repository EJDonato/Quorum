import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "schemas/**"] },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
      "max-lines-per-function": [
        "error",
        { max: 60, skipBlankLines: false, skipComments: false },
      ],
      "max-params": ["error", 3],
      "max-depth": ["error", 3],
    },
  },
  { files: ["tests/**/*.ts"], rules: { "max-lines-per-function": "off" } },
);
