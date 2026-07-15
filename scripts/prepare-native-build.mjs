import { rm } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Return only transient directories that can make HBuilderX reuse an outdated UTS plugin.
 * dist/cache/apk contains the cloud-native base APK used by "quick packaging"; leaving it
 * behind updates only the WGT and silently keeps old DEX files. The release directory is
 * intentionally excluded so previously generated APKs are preserved for comparison.
 */
export function nativeBuildCacheTargets(projectRoot) {
  const root = resolve(projectRoot);
  return [
    resolve(root, "unpackage/resources/uni_modules/sms-backup-native"),
    resolve(root, "unpackage/resources/uni_modules/sms-backup-native-v2"),
    resolve(root, "dist/build/hx"),
    resolve(root, "dist/build/app"),
    resolve(root, "dist/build/app-plus"),
    resolve(root, "dist/build/.nvue"),
    resolve(root, "dist/build/.uvue"),
    resolve(root, "dist/cache/apk"),
    resolve(root, "dist/cache/wgt"),
  ];
}

/**
 * Remove stale native build caches before compiling Android.
 * Every target is checked against the project root before recursive deletion.
 */
export async function cleanNativeBuildCaches(projectRoot, log = console.log) {
  const root = resolve(projectRoot);

  for (const target of nativeBuildCacheTargets(root)) {
    const relativeTarget = relative(root, target);
    const isInsideProject =
      relativeTarget.length > 0 &&
      relativeTarget !== ".." &&
      !relativeTarget.startsWith(`..\\`) &&
      !relativeTarget.startsWith("../");

    if (!isInsideProject) {
      throw new Error(`Refusing to remove a path outside the project: ${target}`);
    }

    await rm(target, { recursive: true, force: true });
    log(`[native-cache] cleared ${relativeTarget}`);
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const isDirectExecution =
  process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);

if (isDirectExecution) {
  const projectRoot = resolve(dirname(scriptPath), "..");
  await cleanNativeBuildCaches(projectRoot);
}
