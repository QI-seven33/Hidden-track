import { build } from "esbuild";
await build({
  entryPoints: ["src/server/index.ts"],
  outfile: `${process.env.BUILD_OUTPUT || "dist"}/server.mjs`,
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
});
