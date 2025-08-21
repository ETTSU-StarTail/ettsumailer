// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod imap_client;

// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
#[tauri::command]
fn get_config() -> config::Config {
    // Attempt to load config, return default if it fails or doesn't exist.
    config::load_config().unwrap_or_default()
}

#[tauri::command]
fn save_config(config: config::Config) -> Result<(), String> {
    config::save_config(&config).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_emails() -> Result<Vec<imap_client::EmailSummary>, String> {
    // Use spawn_blocking for the sync IMAP code to avoid blocking the main async runtime
    tauri::async_runtime::spawn_blocking(|| imap_client::fetch_inbox_emails())
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn fetch_email_body(uid: u32) -> Result<imap_client::EmailBody, String> {
    tauri::async_runtime::spawn_blocking(move || imap_client::fetch_email_body(uid))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}


fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            fetch_emails,
            fetch_email_body
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
