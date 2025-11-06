use crate::config;
use imap::types::Flag;
use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Debug, Clone)]
pub struct EmailSummary {
    pub uid: u32,
    pub from: String,
    pub subject: String,
    pub date: String,
    pub unread: bool,
}

fn get_password(command: &str) -> Result<String, String> {
    let output = Command::new("sh")
        .arg("-c")
        .arg(command)
        .output()
        .map_err(|e| format!("Failed to execute password command: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Password command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let password = String::from_utf8(output.stdout)
        .map_err(|e| format!("Password is not valid UTF-8: {}", e))?
        .trim()
        .to_string();
    Ok(password)
}

fn decode_header(header: &[u8]) -> String {
    String::from_utf8_lossy(header).to_string()
}

pub fn fetch_inbox_emails() -> Result<Vec<EmailSummary>, String> {
    let config =
        config::load_config().map_err(|e| format!("Failed to load configuration: {}", e))?;
    let imap_config = config.imap;

    if imap_config.host.is_empty() {
        return Err("IMAP host is not configured.".to_string());
    }

    let password = get_password(&imap_config.password_command)?;

    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| format!("Failed to build TLS connector: {}", e))?;
    let client = imap::connect(
        (imap_config.host.as_str(), imap_config.port),
        &imap_config.host,
        &tls,
    )
    .map_err(|e| format!("Failed to connect to IMAP server: {}", e))?;

    let mut imap_session = client
        .login(&imap_config.username, &password)
        .map_err(|(e, _)| format!("IMAP login failed: {}", e))?;

    imap_session
        .select("INBOX")
        .map_err(|e| format!("Failed to select INBOX: {}", e))?;

    // Fetch the last 20 messages by sequence number
    let seq_set = "1:*".to_string();
    let messages = imap_session
        .fetch(seq_set, "(UID ENVELOPE FLAGS)")
        .map_err(|e| format!("Failed to fetch messages: {}", e))?;

    let mut emails = vec![];
    for msg in messages.iter().rev().take(30) {
        let envelope = msg.envelope().ok_or("Message has no envelope")?;
        let uid = msg.uid.ok_or("Message has no UID")?;

        let subject = envelope
            .subject
            .as_ref()
            .map(|s| decode_header(s))
            .unwrap_or_else(|| "(no subject)".to_string());

        let from = envelope
            .from
            .as_ref()
            .and_then(|addrs| addrs.get(0))
            .map(|addr| {
                let mailbox = addr.mailbox.as_ref().map(|s| String::from_utf8_lossy(s).to_string()).unwrap_or_default();
                let host = addr.host.as_ref().map(|s| String::from_utf8_lossy(s).to_string()).unwrap_or_default();
                format!("{}@{}", mailbox, host)
            })
            .unwrap_or_else(|| "(unknown sender)".to_string());

        let date = envelope
            .date
            .as_ref()
            .map(|d| String::from_utf8_lossy(d).to_string())
            .unwrap_or_default();

        let unread = !msg.flags().iter().any(|f| matches!(f, Flag::Seen));

        emails.push(EmailSummary {
            uid,
            from,
            subject,
            date,
            unread,
        });
    }

    imap_session.logout().map_err(|e| format!("IMAP logout failed: {}", e))?;

    Ok(emails)
}

#[derive(Serialize, Debug, Clone)]
pub struct EmailBody {
    pub from: String,
    pub to: String,
    pub cc: String,
    pub subject: String,
    pub date: String,
    pub text_body: String,
    pub html_body: String,
}

fn format_addresses(addrs: Option<&mail_parser::Address<'_>>) -> String {
    addrs
        .map(|addr| match addr {
            mail_parser::Address::List(list) => {
                list.iter()
                    .map(|a| format_single_address(a))
                    .collect::<Vec<_>>()
                    .join(", ")
            }
            mail_parser::Address::Group(groups) => {
                groups.iter()
                    .flat_map(|g| g.addresses.iter())
                    .map(|a| format_single_address(a))
                    .collect::<Vec<_>>()
                    .join(", ")
            }
        })
        .unwrap_or_default()
}

fn format_single_address(addr: &mail_parser::Addr<'_>) -> String {
    let name = addr.name.as_ref().map(|s| s.as_ref()).unwrap_or("");
    let address = addr.address.as_ref().map(|s| s.as_ref()).unwrap_or("");
    if name.is_empty() {
        address.to_string()
    } else {
        format!("{} <{}>", name, address)
    }
}

pub fn fetch_email_body(uid: u32) -> Result<EmailBody, String> {
    let config =
        config::load_config().map_err(|e| format!("Failed to load configuration: {}", e))?;
    let imap_config = config.imap;

    if imap_config.host.is_empty() {
        return Err("IMAP host is not configured.".to_string());
    }

    let password = get_password(&imap_config.password_command)?;

    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| format!("Failed to build TLS connector: {}", e))?;
    let client = imap::connect(
        (imap_config.host.as_str(), imap_config.port),
        &imap_config.host,
        &tls,
    )
    .map_err(|e| format!("Failed to connect to IMAP server: {}", e))?;

    let mut imap_session = client
        .login(&imap_config.username, &password)
        .map_err(|(e, _)| format!("IMAP login failed: {}", e))?;

    imap_session
        .select("INBOX")
        .map_err(|e| format!("Failed to select INBOX: {}", e))?;

    let messages = imap_session
        .uid_fetch(uid.to_string(), "BODY[]")
        .map_err(|e| format!("Failed to fetch email body for UID {}: {}", uid, e))?;

    let message = messages
        .get(0)
        .ok_or(format!("No message found for UID {}", uid))?;

    let body = message.body().unwrap_or_default();
    let parsed_message = mail_parser::MessageParser::default()
        .parse(body)
        .ok_or("Failed to parse email body".to_string())?;

    let subject = parsed_message
        .subject()
        .unwrap_or("(no subject)")
        .to_string();
    let from = format_addresses(parsed_message.from());
    let to = format_addresses(parsed_message.to());
    let cc = format_addresses(parsed_message.cc());
    let date = parsed_message
        .date()
        .map(|d| d.to_rfc3339())
        .unwrap_or_default();
    let text_body = parsed_message
        .text_body
        .first()
        .and_then(|idx| parsed_message.part(*idx))
        .and_then(|part| part.text_contents())
        .unwrap_or("")
        .to_string();
    let html_body = parsed_message
        .html_body
        .first()
        .and_then(|idx| parsed_message.part(*idx))
        .and_then(|part| part.text_contents())
        .unwrap_or("")
        .to_string();

    imap_session
        .logout()
        .map_err(|e| format!("IMAP logout failed: {}", e))?;

    Ok(EmailBody {
        from,
        to,
        cc,
        subject,
        date,
        text_body,
        html_body,
    })
}
