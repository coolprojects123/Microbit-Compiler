use std::path::{Path, PathBuf};

/// Windows: scan drive letters for the bootloader's signature file.
/// Linux: ask lsblk for the "MICROBIT" volume label and its mountpoint.
pub fn find_microbit_drive() -> Option<PathBuf> {
    if cfg!(windows) {
        for letter in 'D'..='Z' {
            let drive = PathBuf::from(format!("{letter}:\\"));
            if drive.join("DETAILS.TXT").is_file() {
                return Some(drive);
            }
        }
        None
    } else if cfg!(target_os = "linux") {
        let output = std::process::Command::new("lsblk")
            .args(["-J", "-o", "LABEL,MOUNTPOINT"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let json: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
        search_block_devices(json.get("blockdevices")?)
    } else {
        None
    }
}

fn search_block_devices(devices: &serde_json::Value) -> Option<PathBuf> {
    for dev in devices.as_array()? {
        let label = dev.get("label").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
        let mountpoint = dev.get("mountpoint").and_then(|v| v.as_str());
        if label == "MICROBIT" {
            if let Some(mp) = mountpoint {
                return Some(PathBuf::from(mp));
            }
        }
        if let Some(children) = dev.get("children") {
            if let Some(found) = search_block_devices(children) {
                return Some(found);
            }
        }
    }
    None
}

pub fn flash(hex_path: &Path) -> Result<String, String> {
    if !hex_path.is_file() {
        return Err(format!("HEX not found: {}", hex_path.display()));
    }

    let drive = find_microbit_drive()
        .ok_or_else(|| "No micro:bit detected. Check connection and mount status.".to_string())?;

    let file_name = hex_path.file_name().ok_or("Invalid hex path")?;
    let dest = drive.join(file_name);

    std::fs::copy(hex_path, &dest).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            "Drive is not writable. Please check permissions.".to_string()
        } else {
            format!("Flash failed: {e}")
        }
    })?;

    // Force the OS to commit the write to hardware (important for reliable
    // flashing on Linux). The micro:bit reboots as soon as the hex is fully
    // written, so the file may already be gone by the time we get here — that
    // means the flash worked, so a failure here is not itself an error.
    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(&dest) {
        let _ = file.sync_all();
    }

    Ok("Flash complete.".to_string())
}