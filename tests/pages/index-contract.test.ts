import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

describe("automatic SMS collection home page", () => {
  it("starts one-click SMS, image and video synchronization", () => {
    const page = read("src/pages/index/index.vue");

    expect(page).toContain("一键同步全部");
    expect(page).toContain("收到短信");
    expect(page).toContain("已发短信");
    expect(page).toContain("图片");
    expect(page).toContain("视频");
    expect(page).toContain("相册时间范围由服务器动态控制");
    expect(page).toContain("await smsBackupService.requestMediaPermissions()");
    expect(page).toContain("await smsBackupService.syncNow()");
    expect(page).toContain("同步启动失败，请稍后重试");
    expect(page).toContain("catch (error)");
    expect(page).not.toContain("await smsBackupService.scanExistingMessages()");
  });

  it("configures the shared API token and warns about public HTTP", () => {
    const page = read("src/pages/settings/settings.vue");

    expect(page).toContain('v-model="form.apiToken"');
    expect(page).toContain('type="password"');
    expect(page).toContain("SMS_BACKUP_TOKEN");
    expect(page).toContain("公网 HTTP 会明文传输短信和令牌");
  });
});
