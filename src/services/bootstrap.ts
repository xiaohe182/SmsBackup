import type { SmsBackupService } from "@/services/sms-backup";
import type { AppSettings } from "@/stores/settings";

export async function bootstrapSmsBackup(
  service: SmsBackupService,
  settings: AppSettings,
): Promise<void> {
  await service.saveSettings(settings);
  await service.initialize();
}
