#[tauri::command]
pub fn append_frontend_log(level: String, message: String, context: Option<String>) -> Result<(), String> {
    let level_lc = level.to_lowercase();
    let line = match context {
        Some(ctx) if !ctx.trim().is_empty() => format!("{} | {}", message, ctx),
        _ => message,
    };

    match level_lc.as_str() {
        "error" => log::error!(target: "frontend", "{}", line),
        "warn" | "warning" => log::warn!(target: "frontend", "{}", line),
        "debug" => log::debug!(target: "frontend", "{}", line),
        "trace" => log::trace!(target: "frontend", "{}", line),
        _ => log::info!(target: "frontend", "{}", line),
    }

    Ok(())
}