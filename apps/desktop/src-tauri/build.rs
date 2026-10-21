fn main() {
    println!("cargo:rustc-env=MCP_GATE_TARGET_TRIPLE={}", std::env::var("TARGET").expect("Cargo target triple"));
    tauri_build::build()
}
