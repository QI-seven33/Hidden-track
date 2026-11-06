import { DatabaseSync, backup } from "node:sqlite";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** Online SQLite backup includes committed WAL data. A unique directory prevents overwrite. */
export async function backupDatabase(source, directory) {
  const sourcePath = resolve(source);
  const outputRoot = resolve(directory);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const destination = await mkdtemp(join(outputRoot, "music-backup-"));
  await chmod(destination, 0o700);
  const target = join(destination, "app.sqlite");
  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(db, target);
    await chmod(target, 0o600);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      const check = copy.prepare("PRAGMA quick_check").all();
      if (check.length !== 1 || Object.values(check[0])[0] !== "ok")
        throw new Error("Backup validation failed");
      for (const table of ["sessions", "rooms", "probes"])
        if (
          !copy
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        )
          throw new Error("Backup schema is incomplete");
    } finally {
      copy.close();
    }
    await writeFile(
      join(destination, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          database: "app.sqlite",
          quickCheck: "ok",
          requiresOriginalSessionSecret: true,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    return target;
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: { output: { type: "string" }, help: { type: "boolean" } },
    strict: true,
  });
  if (values.help)
    console.log(
      "node --env-file-if-exists=.env deploy/backup.mjs --output <private-backup-directory>",
    );
  else if (!values.output) {
    console.error("需要 --output 私有备份目录；备份包含账户和房间私有数据。");
    process.exitCode = 1;
  } else {
    try {
      console.log(
        `备份校验通过：${await backupDatabase(process.env.DATABASE_PATH || "./data/app.sqlite", values.output)}`,
      );
    } catch {
      console.error(
        "备份失败。检查数据库路径、目录权限和可用空间；原数据库未修改。",
      );
      process.exitCode = 1;
    }
  }
}
