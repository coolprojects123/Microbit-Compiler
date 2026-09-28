use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tokio::sync::oneshot;

/// Mirrors `ENGINE` / `approve` in compiler.js: one folder for all build output,
/// plus a way to ask the frontend "ok to install X?" and await its answer.
pub struct AppState {
    pub engine: PathBuf,
    next_id: AtomicU32,
    pending: Mutex<HashMap<u32, oneshot::Sender<bool>>>,
    /// Builds run one at a time, since each root (Makecode/MPython/C++) has
    /// shared working files — same reasoning as the `chain` promise queue in
    /// compiler.js.
    pub build_lock: tokio::sync::Mutex<()>,
}

impl AppState {
    pub fn new(engine: PathBuf) -> Self {
        std::fs::create_dir_all(&engine).ok();
        Self {
            engine,
            next_id: AtomicU32::new(1),
            pending: Mutex::new(HashMap::new()),
            build_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Registers a new approval wait and returns (id, receiver). The id is sent
    /// to the frontend in the "approval-request" event; the receiver resolves
    /// when respond_approval(id, ok) is called.
    pub fn register_approval(&self) -> (u32, oneshot::Receiver<bool>) {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        (id, rx)
    }

    /// Called from the `respond_approval` command. Returns false if the id is
    /// unknown (already answered, or the window closed and everything was
    /// resolved to "declined" already).
    pub fn resolve_approval(&self, id: u32, ok: bool) -> bool {
        if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
            let _ = tx.send(ok);
            true
        } else {
            false
        }
    }

    /// Window closed with approvals still pending -> treat every one as "Cancel",
    /// same as the `win.on("closed", ...)` handler in the old main.js.
    pub fn cancel_all_approvals(&self) {
        for (_, tx) in self.pending.lock().unwrap().drain() {
            let _ = tx.send(false);
        }
    }
}
