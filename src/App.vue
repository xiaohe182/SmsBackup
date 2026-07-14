<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";

import { bootstrapSmsBackup } from "@/services/bootstrap";
import { smsBackupService } from "@/services/sms-backup";
import { loadRules } from "@/stores/blacklist";
import { loadSettings, uniKeyValueStorage } from "@/stores/settings";

onLaunch(async () => {
  await bootstrapSmsBackup(
    smsBackupService,
    loadSettings(uniKeyValueStorage),
    loadRules(uniKeyValueStorage),
  );
});
</script>

<style>
button, input { box-sizing: border-box; }
</style>
