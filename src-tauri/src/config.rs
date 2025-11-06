use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// SMTPサーバーの設定
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password_command: String, // パスワードを取得するためのコマンド
}

// IMAPサーバーの設定
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct ImapConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password_command: String, // パスワードを取得するためのコマンド
}

// アプリケーション全体の設定
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Config {
    pub smtp: SmtpConfig,
    pub imap: ImapConfig,
}

// 設定ファイルのパスを取得する
fn get_config_path() -> PathBuf {
    // 本来は tauri::api::path::config_dir() などを使うべきだが、
    // プロトタイプのため、プロジェクトルートに配置する
    PathBuf::from("ettsumailer.config.json")
}

// 設定をファイルから読み込む
pub fn load_config() -> Result<Config, Box<dyn std::error::Error>> {
    let path = get_config_path();
    if !path.exists() {
        // 設定ファイルがなければデフォルト値を返す
        // UI側で設定を促す
        return Ok(Config::default());
    }
    let content = fs::read_to_string(path)?;
    let config: Config = serde_json::from_str(&content)?;
    Ok(config)
}

// 設定をファイルに保存する
pub fn save_config(config: &Config) -> Result<(), Box<dyn std::error::Error>> {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content)?;
    Ok(())
}
