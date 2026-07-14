import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_DCloud_VERSION = "3.0.0-4080720251210001";

describe("uni-app runtime compatibility", () => {
  it("pins every DCloud package to the Android base 4.87 compiler version", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve("package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const packages = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    const dcloudPackages = Object.entries(packages).filter(
      ([name]) =>
        name.startsWith("@dcloudio/") && name !== "@dcloudio/types",
    );

    expect(dcloudPackages.length).toBeGreaterThan(0);
    for (const [name, version] of dcloudPackages) {
      expect(version, name).toBe(EXPECTED_DCloud_VERSION);
    }
  });
});
