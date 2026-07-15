import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Two projects: pure logic runs in node (fast, no DOM); React component
    // tests run in jsdom with Testing Library.
    projects: [
      {
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "components",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
        },
      },
    ],
  },
});
