/**
 * Android Auto Backup for a phone without a server: Google backs up the
 * database (files/SQLite) with the app's preferences, so a new phone or a
 * reinstall finds the data again. The photos stay out: past 25 MB, Android
 * backs up nothing at all. The Keystore entries (expo-secure-store: the AI
 * key, the ChatGPT session) never leave the phone; the app asks to connect the
 * AI again after a restore.
 *
 * Replaces expo-secure-store's rules (it is configured with
 * `configureAndroidBackup: false`), keeping what they did.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const BACKUP = 'symbiose_backup_rules';
const EXTRACTION = 'symbiose_data_extraction_rules';

const rules = `    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>
    <include domain="file" path="SQLite/"/>
    <exclude domain="file" path="SQLite/symbiose.previous.db"/>`;

const FULL_BACKUP = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup, Android 11 and lower: the preferences and the database, not the photos (plugins/with-backup-rules.js). -->
<full-backup-content>
${rules.replace(/^ {4}/gm, '  ')}
</full-backup-content>
`;

const DATA_EXTRACTION = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup, Android 12 and higher: the preferences and the database, not the photos (plugins/with-backup-rules.js). -->
<data-extraction-rules>
  <cloud-backup>
${rules}
  </cloud-backup>
  <device-transfer>
${rules}
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${BACKUP}.xml`), FULL_BACKUP);
      fs.writeFileSync(path.join(dir, `${EXTRACTION}.xml`), DATA_EXTRACTION);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const application = c.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:allowBackup'] = 'true';
      application.$['android:fullBackupContent'] = `@xml/${BACKUP}`;
      application.$['android:dataExtractionRules'] = `@xml/${EXTRACTION}`;
    }
    return c;
  });
};
