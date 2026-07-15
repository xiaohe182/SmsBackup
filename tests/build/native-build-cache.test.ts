import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  cleanNativeBuildCaches,
  nativeBuildCacheTargets,
} from "../../scripts/prepare-native-build.mjs";

describe("Android native build cache preparation", () => {
  it("removes stale native caches without deleting release APKs", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "sms-backup-build-"));
    const releaseApk = join(projectRoot, "dist/release/apk/keep.apk");
    const cachedCloudApk = join(
      projectRoot,
      "dist/cache/apk/__UNI__89C367C_cm.apk",
    );
    const cachedWgt = join(
      projectRoot,
      "dist/cache/wgt/__UNI__89C367C/app-service.js",
    );

    await mkdir(join(projectRoot, "unpackage/resources/uni_modules/sms-backup-native"), {
      recursive: true,
    });
    for (const target of nativeBuildCacheTargets(projectRoot).slice(1)) {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "stale.txt"), "stale", "utf8");
    }
    await mkdir(join(projectRoot, "dist/release/apk"), { recursive: true });
    await writeFile(releaseApk, "release", "utf8");
    await mkdir(join(projectRoot, "dist/cache/apk"), { recursive: true });
    await writeFile(cachedCloudApk, "stale native base", "utf8");
    await mkdir(join(projectRoot, "dist/cache/wgt/__UNI__89C367C"), {
      recursive: true,
    });
    await writeFile(cachedWgt, "stale web bundle", "utf8");

    await cleanNativeBuildCaches(projectRoot, () => undefined);

    for (const target of nativeBuildCacheTargets(projectRoot)) {
      expect(existsSync(target), target).toBe(false);
    }
    expect(existsSync(cachedCloudApk)).toBe(false);
    expect(existsSync(cachedWgt)).toBe(false);
    expect(existsSync(releaseApk)).toBe(true);
  });

  it("runs cache preparation automatically before the Android build", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["prebuild:app-plus"]).toBe(
      "node scripts/prepare-native-build.mjs",
    );
  });
});
