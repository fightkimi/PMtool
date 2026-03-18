import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const cwd = process.cwd();
const envFiles = ['.env.local', '.env'];

for (const file of envFiles) {
  const path = resolve(cwd, file);
  if (existsSync(path)) {
    loadDotenv({ path });
  }
}
