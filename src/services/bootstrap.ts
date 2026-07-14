import type { BlacklistRule } from "@/domain/blacklist";
import type { SmsBackupService } from "@/services/sms-backup";
import type { AppSettings } from "@/stores/settings";

export async function bootstrapSmsBackup(
  service: SmsBackupService,
  settings: AppSettings,
  rules: BlacklistRule[],
): Promise<void> {
  await service.saveSettings(settings);
  await service.saveRules(rules);
  await service.initialize();
}
