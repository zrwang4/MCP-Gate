// Keep the console for development, but not for installed Windows release builds.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

fn main() {
    mcp_gate_lib::run();
}
