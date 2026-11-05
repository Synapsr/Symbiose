// drizzle-kit generate (with any arguments, e.g. --name meal_notes), then the
// app's bundle of the migrations.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('npx', ['drizzle-kit', 'generate', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'scripts/bundle-migrations.mjs')], { cwd: root, stdio: 'inherit' });
