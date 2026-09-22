use rand::{distributions::Alphanumeric, Rng};
use serde::Serialize;
use std::{
    env,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

const MANAGEMENT_ADDR: &str = "127.0.0.1:24889";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreRuntimeStatus {
    pub reachable: bool,
    pub managed: bool,
    pub pid: Option<u32>,
    pub launch_mode: &'static str,
}

pub struct CoreSupervisor {
    child: Mutex<Option<Child>>,
    launch_mode: Mutex<&'static str>,
    bundled_node: Option<PathBuf>,
    bundled_core_entry: Option<PathBuf>,
    management_token: String,
}

impl Default for CoreSupervisor {
    fn default() -> Self {
        Self::new(None, None)
    }
}

impl CoreSupervisor {
    pub fn new(
        bundled_node: Option<PathBuf>,
        bundled_core_entry: Option<PathBuf>,
    ) -> Self {
        let management_token = env::var("MCP_GATE_MANAGEMENT_TOKEN")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(generate_management_token);

        Self {
            child: Mutex::new(None),
            launch_mode: Mutex::new("none"),
            bundled_node,
            bundled_core_entry,
            management_token,
        }
    }

    pub fn ensure_started(&self) -> Result<CoreRuntimeStatus, String> {
        self.reap_exited_child();

        if management_reachable() {
            return Ok(self.status());
        }

        let mut child_guard = self
            .child
            .lock()
            .map_err(|_| "core process lock poisoned".to_string())?;

        if child_guard.is_some() {
            return Ok(self.status_with_guard(&mut child_guard));
        }

        let (mut command, launch_mode) = self.build_core_command()?;
        command
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .env("MCP_GATE_MANAGED_BY_DESKTOP", "1")
            .env("MCP_GATE_MANAGEMENT_TOKEN", &self.management_token);

        let child = command
            .spawn()
            .map_err(|error| format!("failed to start MCP Gate Core: {error}"))?;

        *self
            .launch_mode
            .lock()
            .map_err(|_| "core launch mode lock poisoned".to_string())? = launch_mode;
        *child_guard = Some(child);

        drop(child_guard);

        for _ in 0..30 {
            if management_reachable() {
                break;
            }

            self.reap_exited_child();
            if !self.has_managed_child() {
                break;
            }

            thread::sleep(Duration::from_millis(100));
        }

        Ok(self.status())
    }

    pub fn restart(&self) -> Result<CoreRuntimeStatus, String> {
        self.stop_owned()?;

        for _ in 0..20 {
            if !management_reachable() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }

        self.ensure_started()
    }

    pub fn management_token(&self) -> String {
        self.management_token.clone()
    }

    pub fn status(&self) -> CoreRuntimeStatus {
        self.reap_exited_child();

        let mut child_guard = match self.child.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        self.status_with_guard(&mut child_guard)
    }

    pub fn stop_owned(&self) -> Result<(), String> {
        let mut child_guard = self
            .child
            .lock()
            .map_err(|_| "core process lock poisoned".to_string())?;

        let Some(child) = child_guard.as_mut() else {
            return Ok(());
        };

        let pid = child.id();

        #[cfg(unix)]
        {
            let _ = Command::new("/bin/kill")
                .arg("-TERM")
                .arg(pid.to_string())
                .status();

            for _ in 0..25 {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        *child_guard = None;
                        self.set_launch_mode("none");
                        return Ok(());
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(100)),
                    Err(error) => {
                        return Err(format!("failed to inspect Core process: {error}"));
                    }
                }
            }
        }

        child
            .kill()
            .map_err(|error| format!("failed to kill Core process {pid}: {error}"))?;
        let _ = child.wait();

        *child_guard = None;
        self.set_launch_mode("none");
        Ok(())
    }

    fn has_managed_child(&self) -> bool {
        self.child
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    fn reap_exited_child(&self) {
        let mut child_guard = match self.child.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let should_clear = match child_guard.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(Some(_))),
            None => false,
        };

        if should_clear {
            *child_guard = None;
            self.set_launch_mode("none");
        }
    }

    fn status_with_guard(&self, child_guard: &mut Option<Child>) -> CoreRuntimeStatus {
        let pid = child_guard.as_ref().map(Child::id);
        let managed = pid.is_some();
        let launch_mode = if managed {
            *self
                .launch_mode
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        } else if management_reachable() {
            "external"
        } else {
            "none"
        };

        CoreRuntimeStatus {
            reachable: management_reachable(),
            managed,
            pid,
            launch_mode,
        }
    }

    fn set_launch_mode(&self, value: &'static str) {
        if let Ok(mut launch_mode) = self.launch_mode.lock() {
            *launch_mode = value;
        }
    }
}

fn management_reachable() -> bool {
    let Ok(addr) = MANAGEMENT_ADDR.parse::<SocketAddr>() else {
        return false;
    };

    TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok()
}

impl CoreSupervisor {
    fn build_core_command(&self) -> Result<(Command, &'static str), String> {
        if let Ok(executable) = env::var("MCP_GATE_CORE_EXECUTABLE") {
            if executable.trim().is_empty() {
                return Err("MCP_GATE_CORE_EXECUTABLE cannot be empty".to_string());
            }

            return Ok((Command::new(executable), "managed-executable"));
        }

        if let (Some(node), Some(core_entry)) =
            (&self.bundled_node, &self.bundled_core_entry)
        {
            if node.exists() && core_entry.exists() {
                let mut command = Command::new(node);
                command.arg(core_entry);

                if let Some(core_root) = core_entry
                    .parent()
                    .and_then(|path| path.parent())
                {
                    command.current_dir(core_root);
                }

                return Ok((command, "managed-bundled-node"));
            }
        }

        let node =
            env::var("MCP_GATE_NODE_BINARY").unwrap_or_else(|_| "node".to_string());
        let core_entry = env::var_os("MCP_GATE_CORE_ENTRY")
            .map(PathBuf::from)
            .unwrap_or_else(default_dev_core_entry);

        if !core_entry.exists() {
            return Err(format!(
                "Core entry not found at {}. Set MCP_GATE_CORE_ENTRY or MCP_GATE_CORE_EXECUTABLE.",
                core_entry.display()
            ));
        }

        let mut command = Command::new(node);
        command.arg("--experimental-strip-types").arg(&core_entry);

        if let Some(workspace_root) = core_entry
            .parent()
            .and_then(|path| path.parent())
            .and_then(|path| path.parent())
            .and_then(|path| path.parent())
        {
            command.current_dir(workspace_root);
        }

        Ok((command, "managed-node"))
    }
}

fn default_dev_core_entry() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/core/src/main.ts")
}


fn generate_management_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect()
}
