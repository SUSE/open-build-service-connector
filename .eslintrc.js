module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ["./tsconfig.json"]
  },
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-inferrable-types": "off",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/array-type": "error",
    "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
    "@typescript-eslint/restrict-template-expressions": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { varsIgnorePattern: "_.*" }
    ],
    "@typescript-eslint/no-extra-non-null-assertion": ["error"],
    "@typescript-eslint/no-explicit-any": "off",
    // we use so many callbacks that get an explicit `this`, making this
    // completely unusable
    "@typescript-eslint/unbound-method": "off",
    "@typescript-eslint/no-unnecessary-condition": ["error"],
    "@typescript-eslint/ban-tslint-comment": ["error"],
    "@typescript-eslint/class-literal-property-style": ["error"],
    "@typescript-eslint/consistent-type-assertions": [
      "error",
      { assertionStyle: "as", objectLiteralTypeAssertions: "never" }
    ],
    "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
    "@typescript-eslint/explicit-function-return-type": ["error"],
    "@typescript-eslint/explicit-member-accessibility": [
      "error",
      {
        accessibility: "explicit",
        overrides: {
          constructors: "no-public"
        }
      }
    ],
    "@typescript-eslint/member-delimiter-style": ["error"],
    "@typescript-eslint/no-confusing-void-expression": ["error"],
    "@typescript-eslint/non-nullable-type-assertion-style": ["error"],
    "@typescript-eslint/switch-exhaustiveness-check": ["error"]
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ]
};
