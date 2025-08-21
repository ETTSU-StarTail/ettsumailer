import { invoke } from "@tauri-apps/api/tauri";

// Type definition for the config object, must match Rust structs
interface Config {
  smtp: {
    host: string;
    port: number;
    username: string;
    password_command: string;
  };
  imap: {
    host: string;
    port: number;
    username: string;
    password_command: string;
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
  (document.getElementById('imap-password-cmd') as HTMLInputElement).value = config.imap.password_command;

  (document.getElementById('smtp-host') as HTMLInputElement).value = config.smtp.host;
  (document.getElementById('smtp-port') as HTMLInputElement).value = String(config.smtp.port);
  (document.getElementById('smtp-user') as HTMLInputElement).value = config.smtp.username;
  (document.getElementById('smtp-password-cmd') as HTMLInputElement).value = config.smtp.password_command;

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
      password_command: formData.get('imap_password_cmd') as string,
    },
    smtp: {
      host: formData.get('smtp_host') as string,
      port: Number(formData.get('smtp_port')),
      username: formData.get('smtp_user') as string,
      password_command: formData.get('smtp_password_cmd') as string,
    }
  };

  try {
    await invoke('save_config', { config: newConfig });
    config = newConfig; // Update local config object
    closeSettingsModal();
    // Optionally, show a success message
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

    contentView.innerHTML = `
      <div class="email-header">
        <h2 class="email-subject">${emailBody.subject}</h2>
        <div class="email-meta-details">
          <div><strong>From:</strong> ${emailBody.from}</div>
          <div><strong>To:</strong> ${emailBody.to}</div>
          ${emailBody.cc ? `<div><strong>CC:</strong> ${emailBody.cc}</div>` : ''}
          <div><strong>Date:</strong> ${new Date(emailBody.date).toLocaleString()}</div>
        </div>
      </div>
      <div class="email-body">
        <pre>${emailBody.text_body}</pre>
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

    emailList.innerHTML = emails.map(email => `
      <li class="email-item ${email.unread ? 'unread' : ''}" data-uid="${email.uid}">
        <div class="email-item-details">
          <div class="email-item-sender">${email.from}</div>
          <div class="email-item-subject">${email.subject}</div>
        </div>
        <div class="email-item-meta">
          <div class="email-item-date">${new Date(email.date).toLocaleDateString()}</div>
        </div>
      </li>
    `).join('');

    // Add event listener to the list container using event delegation
    emailList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const emailItem = target.closest<HTMLLIElement>('.email-item');
      if (emailItem && emailItem.dataset.uid) {
        const uid = parseInt(emailItem.dataset.uid, 10);
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
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettingsModal();
    }
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
