import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";

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

/** プレーンテキスト内の URL / mailto を安全なリンクに変換する。 */
function linkifyPlainText(text: string): string {
  const urlRegex = /((?:https?:\/\/|mailto:)[^\s<>")\]]+)/gi;
  let html = '';
  let lastIndex = 0;

  for (const match of text.matchAll(urlRegex)) {
    const fullMatch = match[0];
    const index = match.index ?? 0;

    html += escapeHtml(text.slice(lastIndex, index));
    html += `<a href="${escapeHtml(fullMatch)}" target="_blank" rel="noopener noreferrer">${escapeHtml(fullMatch)}</a>`;
    lastIndex = index + fullMatch.length;
  }

  html += escapeHtml(text.slice(lastIndex));
  return html.replaceAll('\n', '<br>');
}

/**
 * HTML メールから読みやすい safe-HTML を生成する。
 * DOM を直接歩き、<a> はリンクとして保持・<img> は alt テキスト化・
 * ブロック要素を改行に変換する。script/style などは除去する。
 */
function htmlToReadableHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('script, style, noscript, template').forEach(n => n.remove());

  const BLOCK_TAGS = new Set([
    'p', 'div', 'section', 'article', 'header', 'footer', 'aside', 'main',
    'ul', 'ol', 'table', 'tr', 'blockquote', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  ]);

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml((node.textContent ?? '').replaceAll('\u00A0', ' '));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(walk).join('');

    switch (tag) {
      case 'br':  return '<br>';
      case 'hr':  return '<br>';
      case 'img': {
        const alt = (el.getAttribute('alt') ?? '').trim();
        return alt ? escapeHtml(`[画像: ${alt}]`) : '';
      }
      case 'a': {
        const href = (el.getAttribute('href') ?? '').trim();
        // javascript: / cid: は安全でないため除去
        if (!href || /^(javascript:|cid:)/i.test(href)) return inner;
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      }
      case 'li':     return `• ${inner}<br>`;
      case 'strong':
      case 'b':      return `<strong>${inner}</strong>`;
      case 'em':
      case 'i':      return `<em>${inner}</em>`;
      case 'code':   return `<code>${inner}</code>`;
      default: {
        // ブロック要素: inner が既に <br> で終わっていれば重複して追加しない
        if (BLOCK_TAGS.has(tag)) return /<br>\s*$/.test(inner) ? inner : `${inner}<br>`;
        return inner;
      }
    }
  }

  return Array.from(doc.body.childNodes)
    .map(walk)
    .join('')
    .replaceAll(/(<br>\s*){3,}/g, '<br><br>')
    .trim();
}

/**
 * HTML 本文としてレンダリングする価値があるかを判定する。
 * 角括弧を含むだけのプレーンテキスト誤判定を避けるため、主要タグの存在を確認する。
 */
function hasRenderableHtml(html: string): boolean {
  if (!html?.trim()) return false;
  return /<(html|body|div|p|br|table|tr|td|span|img|a|style|head|meta)\b/i.test(html);
}

/**
 * HTMLビュー表示用に、メール本文から危険/不要な実行要素を取り除く。
 * 画像読み込みは許可しつつ、script 実行と外部接続は抑止する。
 */
function sanitizeHtmlForIframe(html: string): string {
  if (!html) return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('script, base').forEach(node => node.remove());

  doc.querySelectorAll('noscript').forEach(node => {
    const fragment = document.createDocumentFragment();
    while (node.firstChild) {
      fragment.appendChild(node.firstChild);
    }
    node.replaceWith(fragment);
  });

  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();

      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }

      if ((name === 'href' || name === 'src' || name === 'srcset') && /^javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  });

  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute(
    'content',
    [
      "default-src 'none'",
      "img-src http: https: data: blob:",
      "media-src http: https: data: blob:",
      "style-src 'unsafe-inline' http: https: data:",
      "font-src http: https: data:",
      "script-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      'upgrade-insecure-requests',
    ].join('; ')
  );

  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';

  doc.head.prepend(referrer);
  doc.head.prepend(csp);

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
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

// Type definition for FetchResult, must match Rust struct
interface FetchResult {
  emails: EmailSummary[];
  total: number;
  page: number;
  total_pages: number;
}

let currentPage = 1;

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
  const contentView = document.querySelector<HTMLElement>('.email-content-view');
  if (!contentView) return;

  // Highlight the active email in the list
  document.querySelectorAll('.email-item.active').forEach(item => item.classList.remove('active'));
  const currentEmailItem = document.querySelector(`.email-item[data-uid='${uid}']`);
  currentEmailItem?.classList.add('active');
  // Mark as read visually
  currentEmailItem?.classList.remove('unread');

  contentView.innerHTML = `<div class="email-content-placeholder">読み込み中…</div>`;

  try {
    const emailBody = await invoke<EmailBody>('fetch_email_body', { uid });

    const subject = escapeHtml(decodeMimeEncodedWord(emailBody.subject));
    const from    = escapeHtml(decodeMimeEncodedWord(emailBody.from));
    const to      = escapeHtml(decodeMimeEncodedWord(emailBody.to));
    const cc      = escapeHtml(decodeMimeEncodedWord(emailBody.cc));
    // HTML本文として意味のあるタグがある場合のみ HTML ビューを有効化
    const hasHtml = hasRenderableHtml(emailBody.html_body ?? '');

    contentView.innerHTML = `
      <div class="email-header">
        <h2 class="email-subject">${subject}</h2>
        <div class="email-meta-details">
          <div><strong>From:</strong> ${from}</div>
          <div><strong>To:</strong> ${to}</div>
          ${emailBody.cc ? `<div><strong>CC:</strong> ${cc}</div>` : ''}
          <div><strong>Date:</strong> ${new Date(emailBody.date).toLocaleString()}</div>
        </div>
        ${hasHtml ? `
        <div class="view-toggle">
          <button class="view-toggle-btn active" data-view="text">テキスト</button>
          <button class="view-toggle-btn" data-view="html">HTML</button>
        </div>` : ''}
      </div>
      <div class="email-body" id="email-body-container"></div>
    `;

    const bodyContainer = document.getElementById('email-body-container');
    if (!bodyContainer) return;

    // テキストビュー内のリンクを既定ブラウザで開く（Tauri WebView 内ナビゲーション防止）
    bodyContainer.addEventListener('click', async (e) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      e.preventDefault();
      await open(href);
    });

    const renderHtmlView = () => {
      bodyContainer.innerHTML = '';
      const iframe = document.createElement('iframe');
      // 画像などの受動的リソースは許可しつつ、メール本文の script 実行は許可しない。
      // allow-same-origin を付けることで親側からリンククリックだけを安全に補足する。
      // allow-forms / allow-top-navigation は禁止のまま維持。
      iframe.setAttribute('sandbox', 'allow-same-origin');
      iframe.title = 'メール本文（HTML）';
      iframe.classList.add('email-html-frame');
      iframe.srcdoc = sanitizeHtmlForIframe(emailBody.html_body);

      iframe.addEventListener('load', () => {
        const doc = iframe.contentDocument;
        if (!doc) return;

        doc.addEventListener('click', async (e) => {
          const target = e.target as Element | null;
          const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
          if (!anchor) return;
          const href = anchor.getAttribute('href')?.trim();
          if (!href) return;

          e.preventDefault();
          if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
            await open(href);
          }
        });
      });

      bodyContainer.appendChild(iframe);
    };

    const renderTextView = () => {
      if (hasHtml) {
        const safeHtml = htmlToReadableHtml(emailBody.html_body) || '（本文を表示できませんでした）';
        bodyContainer.innerHTML = `<div class="email-text-body">${safeHtml}</div>`;
      } else {
        // CRLF → LF に正規化（<pre> 内で \r が余分な改行になるのを防ぐ）
        const plain = emailBody.text_body.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim() || '（本文を表示できませんでした）';
        bodyContainer.innerHTML = `<pre class="email-text-body">${linkifyPlainText(plain)}</pre>`;
      }
    };

    if (hasHtml) {
      renderTextView();
      contentView.querySelectorAll<HTMLButtonElement>('.view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          contentView.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (btn.dataset.view === 'text') {
            renderTextView();
          } else {
            renderHtmlView();
          }
        });
      });
    } else {
      renderTextView();
    }
  } catch (error) {
    contentView.innerHTML = `<div class="email-content-placeholder error">メールを読み込めませんでした: ${escapeHtml(String(error))}</div>`;
  }
}

async function loadEmails(page = currentPage) {
  const emailList = document.querySelector('.email-list');
  const paginationBar = document.querySelector<HTMLElement>('.pagination-bar');
  if (!emailList) return;

  currentPage = page;
  emailList.innerHTML = '<li class="email-item-placeholder">Loading emails...</li>';

  try {
    const result = await invoke<FetchResult>('fetch_emails', { page });

    if (result.emails.length === 0) {
      emailList.innerHTML = '<li class="email-item-placeholder">Your inbox is empty.</li>';
      if (paginationBar) paginationBar.hidden = true;
      return;
    }

    emailList.innerHTML = result.emails.map(email => {
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

    // ページネーションバーを更新
    if (paginationBar) {
      const prevBtn = paginationBar.querySelector<HTMLButtonElement>('.pagination-prev');
      const nextBtn = paginationBar.querySelector<HTMLButtonElement>('.pagination-next');
      const pageInfo = paginationBar.querySelector<HTMLSpanElement>('.pagination-info');
      if (prevBtn) prevBtn.disabled = result.page <= 1;
      if (nextBtn) nextBtn.disabled = result.page >= result.total_pages;
      if (pageInfo) pageInfo.textContent = `${result.page} / ${result.total_pages}`;
      paginationBar.hidden = result.total_pages <= 1;
    }

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

  // Pagination buttons
  const prevBtn = document.querySelector<HTMLButtonElement>('.pagination-prev');
  const nextBtn = document.querySelector<HTMLButtonElement>('.pagination-next');
  prevBtn?.addEventListener('click', () => loadEmails(currentPage - 1));
  nextBtn?.addEventListener('click', () => loadEmails(currentPage + 1));

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
