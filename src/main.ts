import { invoke } from "@tauri-apps/api/core";

/**
 * RFC 2047 MIME encoded-word を人間が読めるテキストにデコードする。
 * 対応パターン: =?charset?B?base64?= および =?charset?Q?quoted-printable?=
 */
function decodeMimeEncodedWord(text: string): string {
  if (!text) return text;
  // 隣接する encoded-word 間の空白は RFC 2047 により無視する
  const collapsed = text.replaceAll(
    /(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(=\?[^?]+\?[BbQq]\?[^?]*\?=)/g,
    '$1$2'
  );
  return collapsed.replaceAll(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (match, charset: string, encoding: string, encodedText: string) => {
      try {
        let bytes: Uint8Array;
        if (encoding.toUpperCase() === 'B') {
          const binaryStr = atob(encodedText);
          bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.codePointAt(i) ?? 0;
          }
        } else {
          // Quoted-Printable: _ は空白、=XX は16進バイト
          const qpStr = encodedText
            .replaceAll('_', ' ')
            .replaceAll(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
              String.fromCodePoint(Number.parseInt(hex, 16))
            );
          bytes = new Uint8Array(qpStr.length);
          for (let i = 0; i < qpStr.length; i++) {
            bytes[i] = qpStr.codePointAt(i) ?? 0;
          }
        }
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return match;
      }
    }
  );
}

/** HTML 特殊文字をエスケープする（innerHTML への直接埋め込み用）。 */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Type definition for the config object, must match Rust structs
interface Config {
  smtp: {
    host: string;
    port: number;
    username: string;
  };
  imap: {
    host: string;
    port: number;
    username: string;
  };
}

let config: Config | null = null;

// DOM Elements
let settingsModal: HTMLDivElement;
let settingsForm: HTMLFormElement;
let cancelButton: HTMLButtonElement;
let settingsButton: HTMLButtonElement;

function openSettingsModal() {
  if (!settingsModal || !config) return;

  // Populate form with current config
  (document.getElementById('imap-host') as HTMLInputElement).value = config.imap.host;
  (document.getElementById('imap-port') as HTMLInputElement).value = String(config.imap.port);
  (document.getElementById('imap-user') as HTMLInputElement).value = config.imap.username;
  // パスワードは資格情報ストアに保管するため、フォームには表示しない

  (document.getElementById('smtp-host') as HTMLInputElement).value = config.smtp.host;
  (document.getElementById('smtp-port') as HTMLInputElement).value = String(config.smtp.port);
  (document.getElementById('smtp-user') as HTMLInputElement).value = config.smtp.username;
  // パスワードは資格情報ストアに保管するため、フォームには表示しない

  settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  if (settingsModal) {
    settingsModal.classList.add('hidden');
  }
}

async function saveSettings(event: SubmitEvent) {
  event.preventDefault();
  const formData = new FormData(settingsForm);

  const newConfig: Config = {
    imap: {
      host: formData.get('imap_host') as string,
      port: Number(formData.get('imap_port')),
      username: formData.get('imap_user') as string,
    },
    smtp: {
      host: formData.get('smtp_host') as string,
      port: Number(formData.get('smtp_port')),
      username: formData.get('smtp_user') as string,
    }
  };

  const imapPassword = formData.get('imap_password') as string;
  const smtpPassword = formData.get('smtp_password') as string;

  try {
    await invoke('save_config', { config: newConfig });

    // パスワードが入力された場合のみ資格情報ストアを更新する
    if (imapPassword) {
      await invoke('save_password', {
        service: `ettsumailer:imap:${newConfig.imap.host}`,
        username: newConfig.imap.username,
        password: imapPassword,
      });
    }
    if (smtpPassword) {
      await invoke('save_password', {
        service: `ettsumailer:smtp:${newConfig.smtp.host}`,
        username: newConfig.smtp.username,
        password: smtpPassword,
      });
    }

    config = newConfig;
    closeSettingsModal();
    alert('Settings saved successfully!');
  } catch (error) {
    console.error('Failed to save settings:', error);
    alert(`Error saving settings: ${error}`);
  }
}

// Type definition for EmailSummary, must match Rust struct
interface EmailSummary {
  uid: number;
  from: string;
  subject: string;
  date: string;
  unread: boolean;
}

// Type definition for EmailBody, must match Rust struct
interface EmailBody {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  text_body: string;
  html_body: string;
}

async function displayEmail(uid: number) {
  const contentView = document.querySelector('.email-content-view');
  if (!contentView) return;

  // Highlight the active email in the list
  document.querySelectorAll('.email-item.active').forEach(item => item.classList.remove('active'));
  const currentEmailItem = document.querySelector(`.email-item[data-uid='${uid}']`);
  currentEmailItem?.classList.add('active');
  // Mark as read visually
  currentEmailItem?.classList.remove('unread');


  contentView.innerHTML = `<div class="email-content-placeholder">Loading email...</div>`;

  try {
    const emailBody = await invoke<EmailBody>('fetch_email_body', { uid });

    const subject = escapeHtml(decodeMimeEncodedWord(emailBody.subject));
    const from    = escapeHtml(decodeMimeEncodedWord(emailBody.from));
    const to      = escapeHtml(decodeMimeEncodedWord(emailBody.to));
    const cc      = escapeHtml(decodeMimeEncodedWord(emailBody.cc));

    contentView.innerHTML = `
      <div class="email-header">
        <h2 class="email-subject">${subject}</h2>
        <div class="email-meta-details">
          <div><strong>From:</strong> ${from}</div>
          <div><strong>To:</strong> ${to}</div>
          ${emailBody.cc ? `<div><strong>CC:</strong> ${cc}</div>` : ''}
          <div><strong>Date:</strong> ${new Date(emailBody.date).toLocaleString()}</div>
        </div>
      </div>
      <div class="email-body">
        <pre>${escapeHtml(emailBody.text_body)}</pre>
      </div>
    `;
    // If there's an HTML body, we could choose to render it in an iframe for security
    // For this prototype, we will stick to the text body.
  } catch (error) {
    contentView.innerHTML = `<div class="email-content-placeholder error">Could not load email: ${error}</div>`;
  }
}

async function loadEmails() {
  const emailList = document.querySelector('.email-list');
  if (!emailList) return;

  emailList.innerHTML = '<li class="email-item-placeholder">Loading emails...</li>';

  try {
    const emails = await invoke<EmailSummary[]>('fetch_emails');

    if (emails.length === 0) {
      emailList.innerHTML = '<li class="email-item-placeholder">Your inbox is empty.</li>';
      return;
    }

    emailList.innerHTML = emails.map(email => {
      const sender  = escapeHtml(decodeMimeEncodedWord(email.from));
      const subject = escapeHtml(decodeMimeEncodedWord(email.subject));
      return `
      <li class="email-item ${email.unread ? 'unread' : ''}" data-uid="${email.uid}">
        <div class="email-item-details">
          <div class="email-item-sender">${sender}</div>
          <div class="email-item-subject">${subject}</div>
        </div>
        <div class="email-item-meta">
          <div class="email-item-date">${new Date(email.date).toLocaleDateString()}</div>
        </div>
      </li>`;
    }).join('');

    // Add event listener to the list container using event delegation
    emailList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const emailItem = target.closest<HTMLLIElement>('.email-item');
      if (emailItem?.dataset.uid) {
        const uid = Number.parseInt(emailItem.dataset.uid, 10);
        displayEmail(uid);
      }
    });

  } catch (error) {
    console.error("Failed to fetch emails:", error);
    emailList.innerHTML = `<li class="email-item-placeholder error">Error: ${error}</li>`;
  }
}


async function initializeApp() {
  // Initialize DOM elements
  settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
  settingsForm = document.getElementById('settings-form') as HTMLFormElement;
  cancelButton = document.getElementById('cancel-settings-button') as HTMLButtonElement;
  settingsButton = document.querySelector('.settings-button') as HTMLButtonElement;

  // Attach event listeners
  settingsButton.addEventListener('click', openSettingsModal);
  cancelButton.addEventListener('click', closeSettingsModal);

  // Close modal only if both mousedown and mouseup happen on the overlay
  // This prevents closing when selecting text and releasing mouse outside modal content
  let mouseDownTarget: EventTarget | null = null;
  settingsModal.addEventListener('mousedown', (e) => {
    mouseDownTarget = e.target;
  });
  settingsModal.addEventListener('mouseup', (e) => {
    if (e.target === settingsModal && mouseDownTarget === settingsModal) {
      closeSettingsModal();
    }
    mouseDownTarget = null;
  });

  settingsForm.addEventListener('submit', async (e) => {
    await saveSettings(e);
    // After saving, try to load emails immediately
    await loadEmails();
  });

  // Load initial config and check if setup is needed
  try {
    config = await invoke<Config>('get_config');
    // A simple check to see if the config is uninitialized
    if (!config.imap.host || !config.smtp.host) {
      const placeholder = document.querySelector('.email-content-placeholder');
      if (placeholder) {
        placeholder.innerHTML = `
          <div class="config-prompt">
            <p>Welcome to ettsumailer! Please configure your email accounts to get started.</p>
            <button id="configure-now-button">Configure Now</button>
          </div>
        `;
        document.getElementById('configure-now-button')?.addEventListener('click', openSettingsModal);
      }
    } else {
      // If config exists, load emails
      await loadEmails();
    }
  } catch (error) {
    console.error("Failed to load configuration:", error);
    alert("Could not load configuration. The app may not function correctly.");
  }
}

document.addEventListener("DOMContentLoaded", initializeApp);
