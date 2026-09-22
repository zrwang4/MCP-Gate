# Tauri Updater and GitHub Releases

MCP Gate uses the Tauri 2 updater with a static GitHub Release manifest:

```text
https://github.com/zrwang4/MCP-Gate/releases/latest/download/latest.json
```

The desktop UI exposes a manual check in **桌面设置 → 软件更新**. When a newer stable version exists, the user can review the version and release note summary, then download, verify, install, and restart the app.

## Trust model

Two independent signatures are involved:

- Apple Developer ID signing and notarization let macOS trust the application.
- The Tauri Updater signature lets the installed application verify a downloaded update artifact.

The updater public key is embedded in `tauri.production.conf.json`. The private key must never be committed and must remain available for the lifetime of every installed client that trusts this public key.

## GitHub Actions secrets

Configure this repository secret with the complete updater private-key file content:

```text
TAURI_SIGNING_PRIVATE_KEY
```

If the key is password protected, also configure:

```text
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The key currently generated for this project is unencrypted, so the password secret may be omitted. Access to the private key itself must be restricted.

## Release assets

For each stable release the workflow publishes:

```text
MCP-Gate-<version>-macOS-arm64.app.tar.gz
MCP-Gate-<version>-macOS-arm64.app.tar.gz.sig
MCP-Gate-<version>-macOS-x86_64.app.tar.gz
MCP-Gate-<version>-macOS-x86_64.app.tar.gz.sig
latest.json
```

`latest.json` maps `darwin-aarch64` and `darwin-x86_64` to the matching assets and embeds the signature text required by Tauri.

## Rollout and verification

The first release containing this updater is the baseline release. Older builds without the updater cannot discover it automatically. To verify the full chain:

1. Install and launch the first updater-capable stable release.
2. Increment every application version and publish a newer stable release.
3. Confirm the draft contains both updater archives, both `.sig` files, and `latest.json`.
4. Publish the GitHub Release. Draft and prerelease releases are not selected by the stable `/releases/latest` endpoint.
5. In the baseline client, choose **检查更新**, then **下载并安装**.
6. Confirm the app restarts on the new version and its managed Core is healthy.

Do not rotate or regenerate the updater key after clients have shipped. A new public key would make existing clients reject future update signatures.
