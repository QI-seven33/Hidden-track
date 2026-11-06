import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const versions = {};
for (const directory of ['art', 'icons', 'audio']) {
  const walk = async (relative) => {
    for (const entry of await fs.readdir(path.join('public', relative), {
      withFileTypes: true,
    })) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(file);
      else
        versions['/' + file] = createHash('sha256')
          .update(await fs.readFile(path.join('public', file)))
          .digest('hex')
          .slice(0, 16);
    }
  };
  await walk(directory);
}
await fs.writeFile(
  'src/shared/asset-versions.json',
  JSON.stringify(versions, null, 2) + '\n',
);
