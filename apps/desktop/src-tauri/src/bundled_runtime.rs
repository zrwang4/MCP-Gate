use std::path::{Path, PathBuf};

pub fn find_bundled_node(
    executable_dir: Option<&Path>,
    resource_dir: Option<&Path>,
    target: &str,
    windows: bool,
) -> Option<PathBuf> {
    let suffix = if windows { ".exe" } else { "" };
    let mut candidates = Vec::new();
    if let Some(dir) = executable_dir {
        candidates.push(dir.join(format!("mcp-gate-node{suffix}")));
        candidates.push(dir.join(format!("mcp-gate-node-{target}{suffix}")));
    }
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("core-runtime").join(format!("node{suffix}")));
    }
    candidates.into_iter().find(|path| path.is_file())
}

pub fn simplify_windows_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        let units: Vec<u16> = path.as_os_str().encode_wide().collect();
        return PathBuf::from(OsString::from_wide(&simplify_windows_units(&units)));
    }
    #[cfg(not(windows))]
    path
}

// Preserve UTF-16, including names that cannot be converted losslessly to UTF-8.
#[cfg(any(windows, test))]
fn simplify_windows_units(units: &[u16]) -> Vec<u16> {
    let unc: Vec<u16> = r"\\?\UNC\".encode_utf16().collect();
    if units.starts_with(&unc) {
        return [r"\\".encode_utf16().collect::<Vec<_>>(), units[unc.len()..].to_vec()].concat();
    }
    let prefix: Vec<u16> = r"\\?\".encode_utf16().collect();
    if units.starts_with(&prefix) {
        let rest = &units[prefix.len()..];
        let drive = rest.len() >= 3
            && ((b'A' as u16..=b'Z' as u16).contains(&rest[0])
                || (b'a' as u16..=b'z' as u16).contains(&rest[0]))
            && rest[1] == b':' as u16
            && rest[2] == b'\\' as u16;
        if drive { return rest.to_vec(); }
    }
    units.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_drive_and_unc_paths_without_changing_other_paths() {
        for (input, expected) in [
            (r"\\?\C:\Program Files\MCP Gate\main.js", r"C:\Program Files\MCP Gate\main.js"),
            (r"\\?\UNC\server\share\main.js", r"\\server\share\main.js"),
            (r"C:\用户\main.js", r"C:\用户\main.js"),
            (r"\\?\Volume{example}\main.js", r"\\?\Volume{example}\main.js"),
        ] {
            let actual = simplify_windows_units(&input.encode_utf16().collect::<Vec<_>>());
            assert_eq!(String::from_utf16(&actual).unwrap(), expected);
        }
    }

    #[test]
    fn preserves_non_utf8_windows_names() {
        let mut input: Vec<u16> = r"\\?\C:\".encode_utf16().collect();
        input.push(0xd800);
        assert_eq!(simplify_windows_units(&input).last(), Some(&0xd800));
    }

    #[test]
    fn selects_only_exact_platform_candidates_and_regular_files() {
        let root = std::env::temp_dir().join(format!("mcp-gate-runtime-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let exe = root.join("bin");
        let resources = root.join("resources");
        std::fs::create_dir_all(&exe).unwrap();
        std::fs::create_dir_all(resources.join("core-runtime")).unwrap();
        let expected = exe.join("mcp-gate-node-x86_64-pc-windows-msvc.exe");
        std::fs::write(exe.join("mcp-gate-node-aarch64-pc-windows-msvc.exe"), b"wrong arch").unwrap();
        std::fs::create_dir(exe.join("mcp-gate-node.exe")).unwrap();
        assert_eq!(find_bundled_node(Some(&exe), Some(&resources), "x86_64-pc-windows-msvc", true), None);
        std::fs::write(&expected, b"node").unwrap();
        assert_eq!(find_bundled_node(Some(&exe), Some(&resources), "x86_64-pc-windows-msvc", true), Some(expected));
        let unix = resources.join("core-runtime/node");
        std::fs::write(&unix, b"node").unwrap();
        assert_eq!(find_bundled_node(Some(&exe), Some(&resources), "x86_64-apple-darwin", false), Some(unix));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[cfg(not(windows))]
    fn leaves_non_windows_paths_unchanged() {
        let path = PathBuf::from("/Applications/MCP Gate.app/Contents/Resources/main.js");
        assert_eq!(simplify_windows_path(path.clone()), path);
    }
}
