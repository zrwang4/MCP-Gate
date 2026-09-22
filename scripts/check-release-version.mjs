import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function readCargoVersion(relativePath) {
  const content = await readFile(resolve(root, relativePath), "utf8");
  const match = content.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Unable to read Cargo package version from ${relativePath}`);
  }
  return match[1];
}

const rootPackage = await readJson("package.json");
const desktopPackage = await readJson("apps/desktop/package.json");
const corePackage = await readJson("packages/core/package.json");
const tauriConfig = await readJson("apps/desktop/src-tauri/tauri.conf.json");
const cargoVersion = await readCargoVersion("apps/desktop/src-tauri/Cargo.toml");

const versions = {
  root: rootPackage.version,
  desktop: desktopPackage.version,
  core: corePackage.version,
  tauri: tauriConfig.version,
  cargo: cargoVersion,
};

const entries = Object.entries(versions);
const [firstName, firstVersion] = entries[0] ?? [];
if (!firstName || typeof firstVersion !== "string") {
  throw new Error("No release version metadata found");
}

for (const [name, version] of entries) {
  if (version !== firstVersion) {
    throw new Error(
      `Version mismatch: ${firstName}=${firstVersion}, ${name}=${version}`,
    );
  }
}

const explicitTag = process.env.RELEASE_TAG?.trim() ?? "";
const githubTag =
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME?.trim() ?? ""
    : "";
const tag = explicitTag || githubTag;

if (tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!match) {
    throw new Error(
      `Release tag must match vX.Y.Z or vX.Y.Z-prerelease, got: ${tag}`,
    );
  }

  const tagVersion = match[1];
  if (tagVersion !== firstVersion) {
    throw new Error(
      `Release tag ${tag} does not match application version ${firstVersion}`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      version: firstVersion,
      tag: tag || null,
      versions,
    },
    null,
    2,
  ),
);
