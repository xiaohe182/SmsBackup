import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

describe("automatic SMS collection home page", () => {
  it("describes automatic collection and treats manual scanning as reconciliation", () => {
    const page = read("src/pages/index/index.vue");

    expect(page).toContain("授权一次后自动收集");
    expect(page).toContain("立即补扫收发短信");
    expect(page).toContain("await smsBackupService.syncNow()");
  });

  it("configures the shared API token and warns about public HTTP", () => {
    const page = read("src/pages/settings/settings.vue");

    expect(page).toContain('v-model="form.apiToken"');
    expect(page).toContain('type="password"');
    expect(page).toContain("SMS_BACKUP_TOKEN");
    expect(page).toContain("公网 HTTP 会明文传输短信和令牌");
  });
});
