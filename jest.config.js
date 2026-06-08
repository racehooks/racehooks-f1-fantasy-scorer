/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          // tests import fixtures via resolveJsonModule
          resolveJsonModule: true,
          esModuleInterop: true,
          strict: true,
        },
      },
    ],
  },
};
