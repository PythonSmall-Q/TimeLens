use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

/// A chat message stored inside a conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::initialize(&conn).unwrap();
        conn
    }

    fn sample_conversation(id: &str, title: &str) -> LlmConversation {
        LlmConversation {
            id: id.to_string(),
            title: title.to_string(),
            created_at: "2024-01-01T10:00:00".to_string(),
            updated_at: "2024-01-01T10:00:00".to_string(),
            archived: false,
            pinned: false,
            messages: vec![
                StoredChatMessage {
                    role: "user".to_string(),
                    content: "Hello".to_string(),
                    hidden: None,
                },
                StoredChatMessage {
                    role: "assistant".to_string(),
                    content: "Hi there".to_string(),
                    hidden: None,
                },
            ],
            summary: None,
        }
    }

    #[test]
    fn upsert_creates_then_updates_on_conflict() {
        let conn = test_db();

        let mut conv = sample_conversation("c1", "First title");
        upsert_llm_conversation(&conn, &conv).unwrap();

        let stored = get_llm_conversation(&conn, "c1").unwrap().unwrap();
        assert_eq!(stored.title, "First title");
        assert_eq!(stored.messages.len(), 2);
        assert_eq!(stored.created_at, "2024-01-01T10:00:00");

        conv.title = "Renamed".to_string();
        conv.updated_at = "2024-01-02T11:00:00".to_string();
        conv.messages.push(StoredChatMessage {
            role: "user".to_string(),
            content: "Follow-up".to_string(),
            hidden: None,
        });
        upsert_llm_conversation(&conn, &conv).unwrap();

        let stored = get_llm_conversation(&conn, "c1").unwrap().unwrap();
        assert_eq!(stored.title, "Renamed");
        assert_eq!(stored.updated_at, "2024-01-02T11:00:00");
        assert_eq!(stored.messages.len(), 3);
        // created_at is not part of the ON CONFLICT update set.
        assert_eq!(stored.created_at, "2024-01-01T10:00:00");

        let listed = list_llm_conversations(&conn, false).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].message_count, 3);
    }

    #[test]
    fn list_excludes_archived_by_default_and_includes_them_on_request() {
        let conn = test_db();

        let mut active = sample_conversation("active", "Active");
        active.updated_at = "2024-01-03T10:00:00".to_string();
        upsert_llm_conversation(&conn, &active).unwrap();

        let mut archived = sample_conversation("archived", "Archived");
        archived.archived = true;
        archived.updated_at = "2024-01-04T10:00:00".to_string();
        upsert_llm_conversation(&conn, &archived).unwrap();

        let visible = list_llm_conversations(&conn, false).unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].id, "active");
        assert!(!visible[0].archived);

        let all = list_llm_conversations(&conn, true).unwrap();
        assert_eq!(all.len(), 2);
        let mut ids: Vec<&str> = all.iter().map(|c| c.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, vec!["active", "archived"]);
        assert!(all.iter().find(|c| c.id == "archived").unwrap().archived);
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let conn = test_db();
        upsert_llm_conversation(&conn, &sample_conversation("c1", "Known")).unwrap();

        let missing = get_llm_conversation(&conn, "does-not-exist").unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn set_archived_and_set_pinned_flip_flags() {
        let conn = test_db();
        upsert_llm_conversation(&conn, &sample_conversation("c1", "Conv")).unwrap();

        set_llm_conversation_archived(&conn, "c1", true).unwrap();
        let stored = get_llm_conversation(&conn, "c1").unwrap().unwrap();
        assert!(stored.archived);
        assert!(!stored.pinned);

        // Hidden from the default list once archived.
        assert!(list_llm_conversations(&conn, false).unwrap().is_empty());
        assert_eq!(list_llm_conversations(&conn, true).unwrap().len(), 1);

        set_llm_conversation_pinned(&conn, "c1", true).unwrap();
        let stored = get_llm_conversation(&conn, "c1").unwrap().unwrap();
        assert!(stored.archived);
        assert!(stored.pinned);

        set_llm_conversation_archived(&conn, "c1", false).unwrap();
        set_llm_conversation_pinned(&conn, "c1", false).unwrap();
        let stored = get_llm_conversation(&conn, "c1").unwrap().unwrap();
        assert!(!stored.archived);
        assert!(!stored.pinned);
    }

    #[test]
    fn delete_removes_the_row() {
        let conn = test_db();
        upsert_llm_conversation(&conn, &sample_conversation("c1", "Conv")).unwrap();
        upsert_llm_conversation(&conn, &sample_conversation("c2", "Other")).unwrap();

        delete_llm_conversation(&conn, "c1").unwrap();
        assert!(get_llm_conversation(&conn, "c1").unwrap().is_none());

        let remaining = list_llm_conversations(&conn, true).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "c2");
    }

    #[test]
    fn messages_roundtrip_preserves_hidden_field() {
        let conn = test_db();
        let mut conv = sample_conversation("c1", "Hidden flags");
        conv.messages = vec![
            StoredChatMessage {
                role: "user".to_string(),
                content: "visible question".to_string(),
                hidden: None,
            },
            StoredChatMessage {
                role: "user".to_string(),
                content: "injected context".to_string(),
                hidden: Some(true),
            },
            StoredChatMessage {
                role: "assistant".to_string(),
                content: "visible answer".to_string(),
                hidden: Some(false),
            },
        ];

        upsert_llm_conversation(&conn, &conv).unwrap();
        let stored = get_llm_conversation(&conn, "c1").unwrap().unwrap();

        assert_eq!(stored.messages.len(), 3);
        assert_eq!(stored.messages[0].hidden, None);
        assert_eq!(stored.messages[1].hidden, Some(true));
        assert_eq!(stored.messages[2].hidden, Some(false));
        assert_eq!(stored.messages[1].content, "injected context");

        // Update the same conversation and keep the hidden flag intact.
        let mut updated = stored.clone();
        updated.messages[0].content = "edited".to_string();
        upsert_llm_conversation(&conn, &updated).unwrap();
        let stored = get_llm_conversation(&conn, "c1").unwrap().unwrap();
        assert_eq!(stored.messages[0].content, "edited");
        assert_eq!(stored.messages[1].hidden, Some(true));
    }
}
