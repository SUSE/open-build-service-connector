module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ["./tsconfig.json"]
  },
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/no-inferrable-types": "off",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/array-type": "error",
    "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
    "@typescript-eslint/restrict-template-expressions": "warn",
    // "@typescript-eslint/no-unused-vars"
    "no-unused-vars": ["error", { varsIgnorePattern: "^_.*" }],
    "@typescript-eslint/no-extra-non-null-assertion": ["error"],
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    // we use so many callbacks that get an explicit `this`, making this
    // completely unusable
    "@typescript-eslint/unbound-method": "off"
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ]
};
