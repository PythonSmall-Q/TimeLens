use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

/// A chat message stored inside a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredChatMessage {
    pub role: String,
    pub content: String,
}

/// Full conversation record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived: bool,
    pub pinned: bool,
    pub messages: Vec<StoredChatMessage>,
    pub summary: Option<String>,
}

/// Lightweight conversation row for the sidebar list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConversationSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub archived: bool,
    pub pinned: bool,
    pub message_count: usize,
}

pub fn list_llm_conversations(
    conn: &Connection,
    include_archived: bool,
) -> Result<Vec<LlmConversationSummary>> {
    let sql = if include_archived {
        "SELECT id, title, created_at, updated_at, archived, pinned, messages
         FROM llm_conversations
         ORDER BY pinned DESC, updated_at DESC"
    } else {
        "SELECT id, title, created_at, updated_at, archived, pinned, messages
         FROM llm_conversations
         WHERE archived = 0
         ORDER BY pinned DESC, updated_at DESC"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        let messages_json: String = row.get(6)?;
        let message_count = serde_json::from_str::<Vec<StoredChatMessage>>(&messages_json)
            .map(|v| v.len())
            .unwrap_or(0);
        Ok(LlmConversationSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            archived: row.get::<_, i32>(4)? != 0,
            pinned: row.get::<_, i32>(5)? != 0,
            message_count,
        })
    })?;
    rows.collect()
}

pub fn get_llm_conversation(conn: &Connection, id: &str) -> Result<Option<LlmConversation>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at, archived, pinned, messages, summary
         FROM llm_conversations
         WHERE id = ?1",
    )?;
    let row = stmt.query_row([id], |row| {
        let messages_json: String = row.get(6)?;
        let summary: Option<String> = row.get(7)?;
        Ok(LlmConversation {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            archived: row.get::<_, i32>(4)? != 0,
            pinned: row.get::<_, i32>(5)? != 0,
            messages: serde_json::from_str(&messages_json).unwrap_or_default(),
            summary,
        })
    });
    match row {
        Ok(conv) => Ok(Some(conv)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn upsert_llm_conversation(conn: &Connection, conversation: &LlmConversation) -> Result<()> {
    let messages_json = serde_json::to_string(&conversation.messages)
        .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))?;
    conn.execute(
        "INSERT INTO llm_conversations (id, title, created_at, updated_at, archived, pinned, messages, summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            updated_at = excluded.updated_at,
            archived = excluded.archived,
            pinned = excluded.pinned,
            messages = excluded.messages,
            summary = excluded.summary",
        params![
            conversation.id,
            conversation.title,
            conversation.created_at,
            conversation.updated_at,
            conversation.archived as i32,
            conversation.pinned as i32,
            messages_json,
            conversation.summary,
        ],
    )?;
    Ok(())
}

pub fn delete_llm_conversation(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM llm_conversations WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn set_llm_conversation_archived(
    conn: &Connection,
    id: &str,
    archived: bool,
) -> Result<()> {
    conn.execute(
        "UPDATE llm_conversations SET archived = ?1, updated_at = ?2 WHERE id = ?3",
        params![archived as i32, chrono::Local::now().to_rfc3339(), id],
    )?;
    Ok(())
}

pub fn set_llm_conversation_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<()> {
    conn.execute(
        "UPDATE llm_conversations SET pinned = ?1, updated_at = ?2 WHERE id = ?3",
        params![pinned as i32, chrono::Local::now().to_rfc3339(), id],
    )?;
    Ok(())
}
