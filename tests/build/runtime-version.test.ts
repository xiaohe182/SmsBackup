import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const EXPECTED_DCloud_VERSION = "3.0.0-4080720251210001";

describe("uni-app runtime compatibility", () => {
  it("uses a new native module id so HBuilder cannot reuse the stale binary", () => {
    const currentModule = resolve("src/uni_modules/sms-backup-native-v2");
    const staleModule = resolve("src/uni_modules/sms-backup-native");

    expect(existsSync(currentModule)).toBe(true);
    expect(existsSync(staleModule)).toBe(false);

    const modulePackage = JSON.parse(
      readFileSync(resolve(currentModule, "package.json"), "utf8"),
    ) as { id: string; version: string };
    expect(modulePackage).toMatchObject({
      id: "sms-backup-native-v2",
      version: "2.0.0",
    });
  });

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
