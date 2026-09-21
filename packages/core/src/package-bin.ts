import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);

type PackageJson = {
  bin?: string | Record<string, string>;
};

export async function resolvePackageBin(
  packageName: string,
  preferredBin?: string,
): Promise<string> {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  ) as PackageJson;

  const bin = packageJson.bin;
  if (!bin) {
    throw new Error(`${packageName} does not declare a bin entry`);
  }

  if (typeof bin === "string") {
    return resolve(dirname(packageJsonPath), bin);
  }

  if (preferredBin && bin[preferredBin]) {
    return resolve(dirname(packageJsonPath), bin[preferredBin]);
  }

  const first = Object.values(bin)[0];
  if (!first) {
    throw new Error(`${packageName} has an empty bin map`);
  }

  return resolve(dirname(packageJsonPath), first);
}
