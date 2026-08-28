use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::AppHandle;

use crate::widget_registry::get_widget_by_type;

#[derive(Default)]
pub struct JvmRuntimeManager {
    processes: Mutex<HashMap<String, Child>>,
}

impl JvmRuntimeManager {
    fn runtime_jar(app: &AppHandle, widget_type: &str) -> Result<PathBuf, String> {
        let item = get_widget_by_type(app, widget_type)
            .ok_or_else(|| format!("widget type not found in registry: {widget_type}"))?;
        if !item
            .runtime_language
            .as_deref()
            .is_some_and(|language| language.eq_ignore_ascii_case("java"))
        {
            return Err(format!("widget is not a Java runtime: {widget_type}"));
        }
        let entry = item
            .runtime_entry
            .ok_or_else(|| "Java runtime entry is missing".to_string())?;
        let manifest_entry = item
            .entry
            .ok_or_else(|| "widget manifest entry is missing".to_string())?;
        let parent = PathBuf::from(manifest_entry)
            .parent()
            .map(PathBuf::from)
            .ok_or_else(|| "widget manifest has no parent directory".to_string())?;
        let jar = parent.join(entry);
        if !jar.is_file() {
            return Err(format!("Java runtime JAR not found: {}", jar.display()));
        }
        Ok(jar)
    }

    pub fn start(&self, app: &AppHandle, widget_id: &str, widget_type: &str) -> Result<(), String> {
        self.stop(widget_id)?;
        let jar = Self::runtime_jar(app, widget_type)?;
        let mut command = Command::new("java");
        command
            .arg("-jar")
            .arg(&jar)
            .current_dir(jar.parent().unwrap_or_else(|| std::path::Path::new(".")))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = command.spawn().map_err(|error| {
            format!(
                "failed to start JVM host; install Java {}: {error}",
                "runtime"
            )
        })?;
        self.processes
            .lock()
            .map_err(|error| error.to_string())?
            .insert(widget_id.to_string(), child);
        Ok(())
    }

    pub fn stop(&self, widget_id: &str) -> Result<(), String> {
        let mut processes = self.processes.lock().map_err(|error| error.to_string())?;
        if let Some(mut child) = processes.remove(widget_id) {
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(())
    }
}

impl Drop for JvmRuntimeManager {
    fn drop(&mut self) {
        if let Ok(processes) = self.processes.get_mut() {
            for (_, mut child) in processes.drain() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
