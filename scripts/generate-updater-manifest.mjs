import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [releaseDir = "release-assets", rawTag = process.env.GITHUB_REF_NAME ?? ""] =
  process.argv.slice(2);
const repository = process.env.GITHUB_REPOSITORY ?? "zrwang4/MCP-Gate";
const tagMatch = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(rawTag);

if (!tagMatch) {
  throw new Error(`Expected release tag vX.Y.Z, got: ${rawTag || "<empty>"}`);
}

const version = tagMatch[1];
const baseUrl = `https://github.com/${repository}/releases/download/${rawTag}`;
const assets = {
  "darwin-aarch64": `MCP-Gate-${version}-macOS-arm64.app.tar.gz`,
  "darwin-x86_64": `MCP-Gate-${version}-macOS-x86_64.app.tar.gz`,
};

const platforms = {};
for (const [platform, asset] of Object.entries(assets)) {
  const signature = (await readFile(join(releaseDir, `${asset}.sig`), "utf8")).trim();
  if (!signature) {
    throw new Error(`Updater signature is empty: ${asset}.sig`);
  }

  platforms[platform] = {
    signature,
    url: `${baseUrl}/${asset}`,
  };
}

const manifest = {
  version,
  notes: `See the MCP Gate ${rawTag} GitHub Release for details.`,
  pub_date: new Date().toISOString(),
  platforms,
};

await writeFile(
  join(releaseDir, "latest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify(manifest, null, 2));
