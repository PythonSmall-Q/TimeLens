use crate::commands::storage_cmd::DbState;
use crate::db::llm_conversations as db;
use tauri::State;

/// List all LLM conversations, optionally including archived ones.
#[tauri::command]
pub fn list_llm_conversations(
    db_state: State<DbState>,
    include_archived: bool,
) -> Result<Vec<db::LlmConversationSummary>, String> {
    let conn = db_state.lock().map_err(|e| e.to_string())?;
    db::list_llm_conversations(&conn, include_archived).map_err(|e| e.to_string())
}

/// Get a single conversation by ID.
#[tauri::command]
pub fn get_llm_conversation(
    db_state: State<DbState>,
    id: String,
) -> Result<Option<db::LlmConversation>, String> {
    let conn = db_state.lock().map_err(|e| e.to_string())?;
    db::get_llm_conversation(&conn, &id).map_err(|e| e.to_string())
}

/// Save or update a conversation.
#[tauri::command]
pub fn save_llm_conversation(
    db_state: State<DbState>,
    conversation: db::LlmConversation,
) -> Result<(), String> {
    let conn = db_state.lock().map_err(|e| e.to_string())?;
    db::upsert_llm_conversation(&conn, &conversation).map_err(|e| e.to_string())
}

/// Delete a conversation permanently.
#[tauri::command]
pub fn delete_llm_conversation(db_state: State<DbState>, id: String) -> Result<(), String> {
    let conn = db_state.lock().map_err(|e| e.to_string())?;
    db::delete_llm_conversation(&conn, &id).map_err(|e| e.to_string())
}

/// Archive or unarchive a conversation.
#[tauri::command]
pub fn archive_llm_conversation(
    db_state: State<DbState>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    let conn = db_state.lock().map_err(|e| e.to_string())?;
    db::set_llm_conversation_archived(&conn, &id, archived).map_err(|e| e.to_string())
}

/// Pin or unpin a conversation.
#[tauri::command]
pub fn pin_llm_conversation(
    db_state: State<DbState>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    let conn = db_state.lock().map_err(|e| e.to_string())?;
    db::set_llm_conversation_pinned(&conn, &id, pinned).map_err(|e| e.to_string())
}
