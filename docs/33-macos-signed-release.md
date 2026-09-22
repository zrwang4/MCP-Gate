# macOS Signed Release

MCP Gate now has two macOS packaging workflows.

## Release Preview

`.github/workflows/release-preview.yml`

Manual, unsigned build for verifying the production bundle layout. It does not require Apple credentials.

## Formal Release

`.github/workflows/release.yml`

Triggered only by a version tag:

```text
v0.3.0
v0.3.0-beta.1
```

Before signing, `pnpm release:check` verifies that these versions match:

- root `package.json`
- Desktop `package.json`
- Core `package.json`
- Tauri `tauri.conf.json`
- Rust `Cargo.toml`
- release tag, when present

## Required GitHub Actions secrets

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
KEYCHAIN_PASSWORD
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

`APPLE_CERTIFICATE` is the base64-encoded Developer ID Application `.p12` certificate. `APPLE_PASSWORD` should be an Apple app-specific password.

`TAURI_SIGNING_PRIVATE_KEY` contains the complete Tauri Updater private key. It is independent from the Apple certificate and must be backed up permanently. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional and may be omitted for an unencrypted key.

## Architectures

Formal releases build two native macOS variants in parallel:

```text
macos-latest    → arm64   → Apple Silicon
macos-15-intel → x86_64  → Intel Mac
```

Each runner stages its own matching Node sidecar, so the bundled runtime architecture matches the Tauri binary.

## Release flow

```text
push vX.Y.Z tag
  ↓
version consistency + tests + typecheck + build
  ↓
┌──────────────────────────┬──────────────────────────┐
│ macos-latest / arm64     │ macos-15-intel / x86_64│
│ Developer ID signing     │ Developer ID signing     │
│ notarization + stapling  │ notarization + stapling  │
│ DMG + app.zip            │ DMG + app.zip            │
│ updater tar.gz + .sig    │ updater tar.gz + .sig    │
└──────────────────────────┴──────────────────────────┘
                  ↓
       download both artifacts
                  ↓
       latest.json + SHA256SUMS.txt
                  ↓
          draft GitHub Release
```

The GitHub Release is intentionally created as a draft so the assets can be tested before publishing publicly. The updater cannot see a draft: `releases/latest` changes only after the stable release is published. Prerelease tags remain outside the stable update channel.

## Example

After updating all application versions to `0.3.0` and merging the change:

```bash
git tag v0.3.0
git push origin v0.3.0
```

Do not create a release tag until `pnpm release:check` passes.
