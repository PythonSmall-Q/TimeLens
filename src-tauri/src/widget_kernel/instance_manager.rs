use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::WidgetInstance;

/// In-memory registry of active widget instances.
#[derive(Clone, Default)]
pub struct InstanceManager {
    inner: Arc<Mutex<HashMap<String, WidgetInstance>>>,
}

impl InstanceManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, instance: WidgetInstance) {
        let mut map = self.inner.lock().unwrap();
        map.insert(instance.widget_id.clone(), instance);
    }

    pub fn unregister(&self, widget_id: &str) {
        let mut map = self.inner.lock().unwrap();
        map.remove(widget_id);
    }

    pub fn get(&self, widget_id: &str) -> Option<WidgetInstance> {
        let map = self.inner.lock().unwrap();
        map.get(widget_id).cloned()
    }

    pub fn list(&self) -> Vec<WidgetInstance> {
        let map = self.inner.lock().unwrap();
        map.values().cloned().collect()
    }

    pub fn set_status(&self, widget_id: &str, status: String) {
        let mut map = self.inner.lock().unwrap();
        if let Some(instance) = map.get_mut(widget_id) {
            instance.status = status;
        }
    }
}
