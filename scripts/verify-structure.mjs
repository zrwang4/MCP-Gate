import { access, readFile } from "node:fs/promises";

const required = [
  "package.json",
  "pnpm-workspace.yaml",
  "packages/core/src/main.ts",
  "packages/core/src/proxy-process.ts",
  "apps/desktop/src/App.tsx",
  "apps/desktop/src-tauri/tauri.conf.json",
  "docs/04-poc-runbook.md",
];

for (const path of required) {
  await access(new URL(`../${path}`, import.meta.url));
}

const packageJson = JSON.parse(
  await readFile(new URL("../packages/core/package.json", import.meta.url), "utf8"),
);

if (packageJson.dependencies["mcp-proxy"] !== "6.7.18") {
  throw new Error("Unexpected mcp-proxy version");
}

console.log(`structure ok: ${required.length} required files found`);
