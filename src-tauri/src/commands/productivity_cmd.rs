use chrono::{Datelike, Timelike};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::storage_cmd::DbState;
use crate::db;
use crate::models::{CategoryComparison, DistractionHotspot, GoalRiskAlert, ProjectComparison};

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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FocusWindowSuggestion {
    pub start_hour: u8,
    pub end_hour: u8,
    pub confidence: f32,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GoalAdjustmentSuggestion {
    pub goal_id: i64,
    pub scope_type: String,
    pub scope_value: String,
    pub recommendation: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageAnomalyMarker {
    pub date: String,
    pub current_seconds: i64,
    pub baseline_seconds: i64,
    pub delta_seconds: i64,
    pub delta_ratio: f64,
    pub direction: String,
    pub reason: String,
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
        .prepare("SELECT first_seen_at FROM app_usage WHERE date = ?1 ORDER BY first_seen_at")
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

    let secs: Vec<i64> = timestamps.iter().filter_map(|ts| parse_secs(ts)).collect();

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

#[tauri::command]
pub fn suggest_focus_windows(
    lookback_days: Option<i64>,
    db: State<'_, DbState>,
) -> Result<Vec<FocusWindowSuggestion>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let days = lookback_days.unwrap_or(21).clamp(3, 90);
    let start_date = (chrono::Local::now() - chrono::Duration::days(days - 1))
        .format("%Y-%m-%d")
        .to_string();

    let mut stmt = conn
        .prepare(
            "SELECT CAST(substr(a.first_seen_at, 12, 2) AS INTEGER) as hour,
                    COALESCE(SUM(a.active_seconds), 0) as total_seconds
             FROM app_usage a
             LEFT JOIN app_categories c ON lower(COALESCE(a.exe_path, '')) = lower(COALESCE(c.exe_path, ''))
             WHERE a.date >= ?1
               AND lower(COALESCE(c.category, '')) IN ('work', 'study')
             GROUP BY hour
             ORDER BY total_seconds DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(i64, i64)> = stmt
        .query_map(params![start_date], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let max_seconds = rows.iter().map(|(_, secs)| *secs).max().unwrap_or(1) as f32;
    let mut out = Vec::new();
    for (hour, total_seconds) in rows.into_iter().take(3) {
        let start_hour = hour.clamp(0, 23) as u8;
        out.push(FocusWindowSuggestion {
            start_hour,
            end_hour: (start_hour + 1).min(23),
            confidence: (total_seconds as f32 / max_seconds).clamp(0.1, 1.0),
            reason: format!(
                "Historically high focused usage in this window over the last {} days",
                days
            ),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn suggest_goal_adjustments(
    db: State<'_, DbState>,
) -> Result<Vec<GoalAdjustmentSuggestion>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let week_start = (chrono::Local::now() - chrono::Duration::days(6))
        .format("%Y-%m-%d")
        .to_string();
    let progress = crate::db::get_goal_progress(&conn, &today, &week_start, &today)
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for item in progress {
        let Some(goal_id) = item.goal.id else {
            continue;
        };
        let (recommendation, reason) = if item.progress_ratio >= 1.5 {
            (
                "increase_target".to_string(),
                "Goal has been consistently exceeded; consider a realistic stretch target."
                    .to_string(),
            )
        } else if item.progress_ratio <= 0.4 {
            (
                "decrease_target".to_string(),
                "Goal appears too aggressive based on recent completion ratio.".to_string(),
            )
        } else {
            (
                "keep_target".to_string(),
                "Current target appears balanced with recent usage behavior.".to_string(),
            )
        };

        out.push(GoalAdjustmentSuggestion {
            goal_id,
            scope_type: item.goal.scope_type,
            scope_value: item.goal.scope_value,
            recommendation,
            reason,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn detect_usage_anomalies(
    date: String,
    baseline_days: Option<i64>,
    db: State<'_, DbState>,
) -> Result<Vec<UsageAnomalyMarker>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let baseline_days = baseline_days.unwrap_or(14).clamp(7, 60);
    let baseline_start = match chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d") {
        Ok(d) => (d - chrono::Duration::days(baseline_days))
            .format("%Y-%m-%d")
            .to_string(),
        Err(_) => return Err("date must be in YYYY-MM-DD format".to_string()),
    };
    let baseline_end = match chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d") {
        Ok(d) => (d - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string(),
        Err(_) => return Err("date must be in YYYY-MM-DD format".to_string()),
    };

    let current_seconds: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_seconds), 0)
             FROM daily_app_usage
             WHERE date = ?1",
            params![date],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let baseline_seconds: i64 = conn
        .query_row(
            "SELECT COALESCE(AVG(day_total), 0)
             FROM (
                 SELECT date, COALESCE(SUM(total_seconds), 0) as day_total
                 FROM daily_app_usage
                 WHERE date >= ?1 AND date <= ?2
                 GROUP BY date
             )",
            params![baseline_start, baseline_end],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if baseline_seconds <= 0 {
        return Ok(Vec::new());
    }

    let delta_seconds = current_seconds - baseline_seconds;
    let delta_ratio = delta_seconds as f64 / baseline_seconds as f64;
    if delta_ratio.abs() < 0.25 {
        return Ok(Vec::new());
    }

    let direction = if delta_ratio > 0.0 { "spike" } else { "drop" }.to_string();
    let reason = if delta_ratio > 0.0 {
        format!("Usage is {:.0}% above recent baseline", delta_ratio * 100.0)
    } else {
        format!(
            "Usage is {:.0}% below recent baseline",
            delta_ratio.abs() * 100.0
        )
    };

    Ok(vec![UsageAnomalyMarker {
        date,
        current_seconds,
        baseline_seconds,
        delta_seconds,
        delta_ratio,
        direction,
        reason,
    }])
}

// ── Phase 4: local intelligence ───────────────────────────────

/// Recompute derived metrics tables from scratch (repair/scheduler entry point).
#[tauri::command]
pub fn rebuild_derived_metrics(db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::rebuild_derived_metrics(&conn).map_err(|e| e.to_string())
}

/// Return the top distraction hotspots for a date range.
#[tauri::command]
pub fn get_distraction_hotspots(
    start_date: String,
    end_date: String,
    limit: Option<i64>,
    db: State<DbState>,
) -> Result<Vec<DistractionHotspot>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(10).max(1);

    // Per-hour app switch density joined with daily totals for app names.
    let mut stmt = conn
        .prepare(
            "SELECT d.date,
                    d.hour,
                    d.switch_count,
                    d.app_switch_count,
                    COALESCE(i.fragment_score_avg, 0.0) as fragment_score
             FROM app_switch_density d
             LEFT JOIN interruption_summary i
               ON i.date = d.date AND i.hour = d.hour
             WHERE d.date >= ?1 AND d.date <= ?2
             ORDER BY (d.switch_count * CAST(COALESCE(i.fragment_score_avg, 0.0) * 100 AS INTEGER)) DESC
             LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, i32, i64, i64, f64)> = stmt
        .query_map(params![start_date, end_date, limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i32>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, f64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    let mut out = Vec::new();
    for (date, hour, switch_count, _app_switch_count, fragment_score) in rows {
        // Find the top app by daily usage for this date/hour from raw usage.
        let top_app: Option<(String, i64, i64)> = conn
            .query_row(
                "SELECT app_name,
                        COUNT(1) as sessions,
                        SUM(CASE WHEN active_seconds < 300 THEN 1 ELSE 0 END) as short_sessions
                 FROM app_usage
                 WHERE date = ?1
                   AND CAST(substr(first_seen_at, 12, 2) AS INTEGER) = ?2
                 GROUP BY app_name
                 ORDER BY COUNT(1) DESC
                 LIMIT 1",
                params![date, hour],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let (app_name, sessions, short_sessions) =
            top_app.unwrap_or_else(|| ("Unknown".to_string(), 1, 0));
        let short_session_ratio = if sessions > 0 {
            short_sessions as f64 / sessions as f64
        } else {
            0.0
        };

        let reason = if fragment_score >= 0.5 {
            "Highly fragmented hour with frequent context switches".to_string()
        } else if switch_count >= 20 {
            "High switch count indicates frequent interruptions".to_string()
        } else {
            "Moderate context switching in this window".to_string()
        };

        out.push(DistractionHotspot {
            date,
            hour,
            app_name,
            switch_count,
            short_session_ratio,
            fragment_score,
            reason,
        });
    }

    out.sort_by(|a, b| {
        let score_a = a.switch_count as f64 * a.fragment_score;
        let score_b = b.switch_count as f64 * b.fragment_score;
        score_b
            .partial_cmp(&score_a)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(limit as usize);
    Ok(out)
}

/// Compare category usage between two date ranges.
#[tauri::command]
pub fn get_category_comparison_in_ranges(
    current_start: String,
    current_end: String,
    previous_start: String,
    previous_end: String,
    db: State<DbState>,
) -> Result<Vec<CategoryComparison>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let current = db::get_category_totals_in_range(&conn, &current_start, &current_end)
        .map_err(|e| e.to_string())?;
    let previous = db::get_category_totals_in_range(&conn, &previous_start, &previous_end)
        .map_err(|e| e.to_string())?;

    let mut map: std::collections::BTreeMap<String, (i64, i64)> = std::collections::BTreeMap::new();
    for (category, secs) in current {
        map.insert(category, (secs, 0));
    }
    for (category, secs) in previous {
        if let Some(v) = map.get_mut(&category) {
            v.1 = secs;
        } else {
            map.insert(category, (0, secs));
        }
    }

    let mut rows: Vec<CategoryComparison> = map
        .into_iter()
        .map(|(category, (current_seconds, previous_seconds))| {
            let delta_seconds = current_seconds - previous_seconds;
            let delta_ratio = if previous_seconds > 0 {
                delta_seconds as f64 / previous_seconds as f64
            } else if current_seconds > 0 {
                1.0
            } else {
                0.0
            };
            CategoryComparison {
                category,
                current_seconds,
                previous_seconds,
                delta_seconds,
                delta_ratio,
            }
        })
        .collect();

    rows.sort_by(|a, b| b.current_seconds.cmp(&a.current_seconds));
    Ok(rows)
}

/// Compare VS Code project usage between two date ranges.
#[tauri::command]
pub fn get_project_comparison_in_ranges(
    current_start: String,
    current_end: String,
    previous_start: String,
    previous_end: String,
    db: State<DbState>,
) -> Result<Vec<ProjectComparison>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let current = db::get_vscode_project_stats_in_range(&conn, &current_start, &current_end)
        .map_err(|e| e.to_string())?;
    let previous = db::get_vscode_project_stats_in_range(&conn, &previous_start, &previous_end)
        .map_err(|e| e.to_string())?;

    let mut map: std::collections::BTreeMap<(String, String), (i64, i64)> =
        std::collections::BTreeMap::new();
    for item in current {
        map.insert(
            (item.project_name, item.project_path),
            (item.total_seconds, 0),
        );
    }
    for item in previous {
        if let Some(v) = map.get_mut(&(item.project_name.clone(), item.project_path.clone())) {
            v.1 = item.total_seconds;
        } else {
            map.insert(
                (item.project_name, item.project_path),
                (0, item.total_seconds),
            );
        }
    }

    let mut rows: Vec<ProjectComparison> = map
        .into_iter()
        .map(
            |((project_name, project_path), (current_seconds, previous_seconds))| {
                let delta_seconds = current_seconds - previous_seconds;
                let delta_ratio = if previous_seconds > 0 {
                    delta_seconds as f64 / previous_seconds as f64
                } else if current_seconds > 0 {
                    1.0
                } else {
                    0.0
                };
                ProjectComparison {
                    project_name,
                    project_path,
                    current_seconds,
                    previous_seconds,
                    delta_seconds,
                    delta_ratio,
                }
            },
        )
        .collect();

    rows.sort_by(|a, b| b.current_seconds.cmp(&a.current_seconds));
    Ok(rows)
}

pub fn evaluate_goal_risks_inner(
    conn: &rusqlite::Connection,
) -> Result<Vec<GoalRiskAlert>, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let now = chrono::Local::now();
    let weekday = now.weekday().num_days_from_sunday() as i64;
    let week_start = (now.date_naive() - chrono::Duration::days(weekday))
        .format("%Y-%m-%d")
        .to_string();
    let week_end = (now.date_naive() + chrono::Duration::days(6 - weekday))
        .format("%Y-%m-%d")
        .to_string();

    let _goals = db::get_usage_goals(&conn).map_err(|e| e.to_string())?;
    let progress =
        db::get_goal_progress(&conn, &today, &week_start, &week_end).map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for item in progress
        .into_iter()
        .filter(|p| p.goal.enabled && p.goal.notify_risk)
    {
        let Some(goal_id) = item.goal.id else {
            continue;
        };

        let (elapsed_ratio, projection_ratio) = if item.goal.period == "weekly" {
            let elapsed = (weekday + 1).clamp(1, 7) as f64 / 7.0;
            let projected = if elapsed > 0.0 {
                item.progress_ratio / elapsed
            } else {
                item.progress_ratio
            };
            (elapsed, projected)
        } else {
            let seconds_since_midnight =
                now.hour() as i64 * 3600 + now.minute() as i64 * 60 + now.second() as i64;
            let elapsed = seconds_since_midnight as f64 / 86400.0;
            let projected = if elapsed > 0.05 {
                item.progress_ratio / elapsed
            } else {
                item.progress_ratio
            };
            (elapsed.max(0.05), projected)
        };

        let alert = if item.goal.operator == "at_least" {
            if item.progress_ratio < elapsed_ratio - 0.1 {
                Some((
                    format!(
                        "Behind schedule: {:.0}% of target achieved vs {:.0}% of time elapsed",
                        item.progress_ratio * 100.0,
                        elapsed_ratio * 100.0
                    ),
                    "medium",
                ))
            } else if projection_ratio < 0.8 {
                Some((
                    "Current pace suggests the goal may not be met today".to_string(),
                    "high",
                ))
            } else {
                None
            }
        } else {
            // at_most
            if item.progress_ratio > 0.9 {
                Some((
                    format!(
                        "Approaching limit: {:.0}% of daily cap used",
                        item.progress_ratio * 100.0
                    ),
                    "high",
                ))
            } else if item.progress_ratio > 0.8 {
                Some((
                    format!(
                        "Nearing limit: {:.0}% of daily cap used",
                        item.progress_ratio * 100.0
                    ),
                    "medium",
                ))
            } else {
                None
            }
        };

        if let Some((message, severity)) = alert {
            out.push(GoalRiskAlert {
                goal_id,
                scope_value: item.goal.scope_value,
                message,
                severity: severity.to_string(),
            });
        }
    }

    Ok(out)
}

/// Evaluate usage goals and return any at-risk goals (command entry point).
#[tauri::command]
pub fn evaluate_goal_risks(db: State<DbState>) -> Result<Vec<GoalRiskAlert>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    evaluate_goal_risks_inner(&conn)
}
