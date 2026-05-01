// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod imap_client;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn get_config() -> config::Config {
    // Attempt to load config, return default if it fails or doesn't exist.
    config::load_config().unwrap_or_default()
}

#[tauri::command]
fn save_config(config: config::Config) -> Result<(), String> {
    config::save_config(&config).map_err(|e| e.to_string())
}

/// IMAP/SMTP のパスワードを OS ネイティブの資格情報ストアに保存する。
/// service は "ettsumailer:imap:{host}" または "ettsumailer:smtp:{host}" 形式。
#[tauri::command]
fn save_password(service: String, username: String, password: String) -> Result<(), String> {
    imap_client::set_password(&service, &username, &password)
}

#[tauri::command]
async fn fetch_emails(page: u32) -> Result<imap_client::FetchResult, String> {
    // Use spawn_blocking for the sync IMAP code to avoid blocking the main async runtime
    tokio::task::spawn_blocking(move || imap_client::fetch_inbox_emails(page))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
async fn fetch_email_body(uid: u32) -> Result<imap_client::EmailBody, String> {
    tokio::task::spawn_blocking(move || imap_client::fetch_email_body(uid))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

fn init_credential_store() {
    #[cfg(windows)]
    {
        let store = windows_native_keyring_store::Store::new()
            .expect("Failed to initialize Windows Credential Manager");
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "macos")]
    {
        let store = apple_native_keyring_store::Store::new()
            .expect("Failed to initialize macOS Keychain");
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "linux")]
    {
        let store = dbus_secret_service_keyring_store::Store::new()
            .expect("Failed to initialize DBus Secret Service");
        keyring_core::set_default_store(store);
    }
}

fn main() {
    init_credential_store();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            save_password,
            fetch_emails,
            fetch_email_body
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
