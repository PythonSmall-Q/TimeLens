use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::storage_cmd::DbState;

// ── Types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProductivityScore {
    pub date: String,
    pub total_seconds: i64,
    pub focus_seconds: i64,
    pub switch_count: i64,
    pub score: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InterruptionPeriod {
    pub hour: u8,
    pub switch_count: u32,
    pub fragment_score: f32,
}

// ── Score calculation ─────────────────────────────────────────

/// score = clamp(focusRatio * 60 + (1 - switchPenalty) * 40, 0, 100)
fn compute_score(total_seconds: i64, focus_seconds: i64, switch_count: i64) -> u8 {
    const MAX_SWITCHES: f64 = 100.0; // ≥100 switches → penalty = 1
    if total_seconds == 0 {
        return 0;
    }
    let focus_ratio = (focus_seconds as f64 / total_seconds as f64).min(1.0);
    let switch_penalty = (switch_count as f64 / MAX_SWITCHES).min(1.0);
    let score = focus_ratio * 60.0 + (1.0 - switch_penalty) * 40.0;
    score.round().clamp(0.0, 100.0) as u8
}

// ── Commands ──────────────────────────────────────────────────

#[tauri::command]
pub fn get_productivity_score(
    date: String,
    db: State<'_, DbState>,
) -> Result<ProductivityScore, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Total seconds from daily_app_usage
    let total_seconds: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_seconds), 0) FROM daily_app_usage WHERE date = ?1",
            params![date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Focus seconds: join daily_app_usage with app_categories for 'work' and 'study'
    let focus_seconds: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(d.total_seconds), 0)
             FROM daily_app_usage d
             LEFT JOIN app_categories c ON lower(d.exe_path) = lower(c.exe_path)
             WHERE d.date = ?1
               AND lower(COALESCE(c.category, '')) IN ('work', 'study')",
            params![date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Switch count: number of app_usage rows for the date (each row = one active segment)
    let switch_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM app_usage WHERE date = ?1",
            params![date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let score = compute_score(total_seconds, focus_seconds, switch_count);

    Ok(ProductivityScore {
        date,
        total_seconds,
        focus_seconds,
        switch_count,
        score,
    })
}

/// Compute productivity scores for every day in [start_date, end_date].
#[tauri::command]
pub fn get_productivity_score_range(
    start_date: String,
    end_date: String,
    db: State<'_, DbState>,
) -> Result<Vec<ProductivityScore>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Fetch all daily totals in range
    let mut stmt = conn
        .prepare(
            "SELECT date, COALESCE(SUM(total_seconds), 0)
             FROM daily_app_usage
             WHERE date >= ?1 AND date <= ?2
             GROUP BY date
             ORDER BY date",
        )
        .map_err(|e| e.to_string())?;

    let date_rows: Vec<(String, i64)> = stmt
        .query_map(params![start_date, end_date], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let mut results = Vec::new();
    for (date, total_seconds) in date_rows {
        let focus_seconds: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(d.total_seconds), 0)
                 FROM daily_app_usage d
                 LEFT JOIN app_categories c ON lower(d.exe_path) = lower(c.exe_path)
                 WHERE d.date = ?1
                   AND lower(COALESCE(c.category, '')) IN ('work', 'study')",
                params![date],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let switch_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM app_usage WHERE date = ?1",
                params![date],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let score = compute_score(total_seconds, focus_seconds, switch_count);
        results.push(ProductivityScore {
            date,
            total_seconds,
            focus_seconds,
            switch_count,
            score,
        });
    }

    Ok(results)
}

// ── Interruption detection (Phase E) ─────────────────────────

/// Sliding window: 5 min window with ≥ 4 switches → fragment.
/// Returns per-hour fragment info for the given date.
#[tauri::command]
pub fn get_interruption_periods(
    date: String,
    db: State<'_, DbState>,
) -> Result<Vec<InterruptionPeriod>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    // Fetch all app_usage segments for the date, ordered by start time
    let mut stmt = conn
        .prepare(
            "SELECT first_seen_at FROM app_usage WHERE date = ?1 ORDER BY first_seen_at",
        )
        .map_err(|e| e.to_string())?;

    let timestamps: Vec<String> = stmt
        .query_map(params![date], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    // Parse to seconds-since-midnight for easier arithmetic
    fn parse_secs(ts: &str) -> Option<i64> {
        // Format: "2024-01-01T14:30:00" or "2024-01-01 14:30:00"
        let time_part = ts.get(11..19)?;
        let mut parts = time_part.splitn(3, ':');
        let h: i64 = parts.next()?.parse().ok()?;
        let m: i64 = parts.next()?.parse().ok()?;
        let s: i64 = parts.next()?.parse().ok()?;
        Some(h * 3600 + m * 60 + s)
    }

    let secs: Vec<i64> = timestamps
        .iter()
        .filter_map(|ts| parse_secs(ts))
        .collect();

    // Per-hour switch counts
    let mut hour_switches: [u32; 24] = [0; 24];
    for &s in &secs {
        let h = (s / 3600).clamp(0, 23) as usize;
        hour_switches[h] += 1;
    }

    // Sliding window 5 min = 300 s, count switches where ≥ 4 occur in window
    let mut hour_fragment_counts: [u32; 24] = [0; 24];
    for i in 0..secs.len() {
        let window_end = secs[i] + 300;
        let window_count = secs[i..].iter().take_while(|&&t| t <= window_end).count();
        if window_count >= 4 {
            let h = (secs[i] / 3600).clamp(0, 23) as usize;
            hour_fragment_counts[h] += 1;
        }
    }

    let mut result = Vec::new();
    for h in 0..24usize {
        if hour_switches[h] == 0 {
            continue;
        }
        // fragment_score: ratio of fragment windows to total switches in hour
        let fragment_score = if hour_switches[h] > 0 {
            (hour_fragment_counts[h] as f32 / hour_switches[h] as f32).min(1.0)
        } else {
            0.0
        };
        result.push(InterruptionPeriod {
            hour: h as u8,
            switch_count: hour_switches[h],
            fragment_score,
        });
    }

    Ok(result)
}
