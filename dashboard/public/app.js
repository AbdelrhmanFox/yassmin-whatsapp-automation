const dryRunInput = document.getElementById('dryRun');
const retryStatusInput = document.getElementById('retryStatus');
const searchQInput = document.getElementById('searchQ');
const filterStatusInput = document.getElementById('filterStatus');
const envBanner = document.getElementById('envBanner');
const paymentsBody = document.getElementById('paymentsBody');
const toastEl = document.getElementById('toast');
const resultOutput = document.getElementById('resultOutput');
const historyOutput = document.getElementById('historyOutput');
const providerPill = document.getElementById('providerPill');

const statTotal = document.getElementById('statTotal');
const statPending = document.getElementById('statPending');
const statAwaiting = document.getElementById('statAwaiting');
const statSent = document.getElementById('statSent');
const statFailed = document.getElementById('statFailed');

const msgSearchQInput = document.getElementById('msgSearchQ');
const msgFilterStatusInput = document.getElementById('msgFilterStatus');
const messagesBody = document.getElementById('messagesBody');
const recentMessagesBody = document.getElementById('recentMessagesBody');
const pausedChatsBody = document.getElementById('pausedChatsBody');
const threadPanel = document.getElementById('threadPanel');
const threadPhoneEl = document.getElementById('threadPhone');
const threadBubblesEl = document.getElementById('threadBubbles');
const closeThreadPanelBtn = document.getElementById('closeThreadPanel');
const msgStatTotal = document.getElementById('msgStatTotal');
const msgStatAuto = document.getElementById('msgStatAuto');
const msgStatHuman = document.getElementById('msgStatHuman');
const msgStatReceived = document.getElementById('msgStatReceived');
const refreshPaymentsBtn = document.getElementById('refreshPayments');
const refreshMessagesBtn = document.getElementById('refreshMessages');
const keywordsBody = document.getElementById('keywordsBody');
const refreshKeywordsBtn = document.getElementById('refreshKeywords');
const kwNewOrder = document.getElementById('kwNewOrder');
const kwNewActive = document.getElementById('kwNewActive');
const kwNewTrigger = document.getElementById('kwNewTrigger');
const kwNewReply = document.getElementById('kwNewReply');
const kwAddBtn = document.getElementById('kwAddBtn');
const kwEditModal = document.getElementById('kwEditModal');
const kwEditId = document.getElementById('kwEditId');
const kwEditOrder = document.getElementById('kwEditOrder');
const kwEditActive = document.getElementById('kwEditActive');
const kwEditKeyword = document.getElementById('kwEditKeyword');
const kwEditReply = document.getElementById('kwEditReply');
const kwEditSave = document.getElementById('kwEditSave');
const kwEditCancel = document.getElementById('kwEditCancel');
const kwEditDelete = document.getElementById('kwEditDelete');
const kwEditCloseX = document.getElementById('kwEditCloseX');

/** نسخة محلية من آخر تحميل لتعبئة نافذة التعديل */
let keywordsCache = [];

const STATUS_LABELS = {
  pending_review: 'بانتظار المراجعة',
  awaiting_whatsapp: 'مؤكد — بانتظار واتساب',
  sent: 'تم الإرسال',
  failed: 'فشل',
  dead_letter: 'Dead letter',
  confirmed: 'مؤكد'
};

const PROVIDER_LABELS = {
  supabase: 'Supabase',
  'supabase-edge': 'Supabase Edge'
};

const MSG_STATUS_LABELS = {
  received: 'رسالة واردة',
  auto_replied: 'رد تلقائي',
  human_handoff: 'تحويل لرد بشري',
  payment_confirmation: 'تأكيد دفع (لوحة)',
  human_handoff_skipped: 'تخطي (إيقاف مؤقت)',
  paused_skipped: 'تخطي مؤقت',
  inbound_filtered: 'مرفوض (فلتر الويب هوك)',
  dedup_blocked: 'لم يُرسل (حد مكافح السبام)'
};

let searchDebounce;
let msgSearchDebounce;
let autoRefreshTimer;

function apiHeaders() {
  return { 'Content-Type': 'application/json' };
}

function showToast(message, type = 'ok') {
  toastEl.textContent = message;
  toastEl.className = `toast toast--${type}`;
  toastEl.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 3500);
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function keywordPreviewText(s, maxLen) {
  const t = String(s ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusBadge(status) {
  const label = STATUS_LABELS[status] || status || '—';
  const cls = STATUS_LABELS[status] ? status : 'pending_review';
  return `<span class="badge badge--${escapeHtml(cls)}">${escapeHtml(label)}</span>`;
}

function msgStatusBadge(status) {
  const label = MSG_STATUS_LABELS[status] || status || '—';
  const cls = MSG_STATUS_LABELS[status] ? status : 'received';
  return `<span class="badge badge--${escapeHtml(cls)}">${escapeHtml(label)}</span>`;
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(iso);
  }
}

function truncate(s, n = 80) {
  const t = String(s ?? '').trim();
  if (t.length <= n) return t || '—';
  return t.slice(0, n) + '…';
}

function formatProduct(row) {
  if (row.product_label && row.product_code) {
    return `${row.product_label} (${row.product_code})`;
  }
  return row.product_label || row.product_code || '—';
}

function receiptCell(row) {
  const url = row.receipt_url || '';
  if (!url) return '—';
  const isImg = /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url) || url.includes('/storage/v1/object/public/receipts/');
  if (isImg) {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="receipt-thumb-link"><img src="${escapeHtml(url)}" alt="إيصال" class="receipt-thumb" loading="lazy" /></a>`;
  }
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">عرض الإيصال ↗</a>`;
}

function renderStats(stats) {
  if (!stats) return;
  statTotal.textContent = stats.total ?? '0';
  statPending.textContent = stats.pending_review ?? '0';
  statAwaiting.textContent = stats.awaiting_whatsapp ?? '0';
  statSent.textContent = stats.sent ?? '0';
  statFailed.textContent = (stats.failed ?? 0) + (stats.dead_letter ?? 0);
}

function canSendNow(row) {
  if (!row.done) return false;
  const wa = String(row.whatsapp_status || '').toLowerCase();
  if (wa === 'sent') return false;
  if (wa === 'dead_letter' || row.dead_letter) return false;
  return true;
}

function sendNowButton(row) {
  if (!canSendNow(row)) {
    const wa = String(row.whatsapp_status || '').toLowerCase();
    if (wa === 'sent') return '<span class="send-now-hint">تم الإرسال</span>';
    if (!row.done) return '<span class="send-now-hint">أكّدي أولاً</span>';
    return '<span class="send-now-hint">—</span>';
  }
  return `<button type="button" class="btn-sm btn-send-now" data-id="${escapeHtml(row.id)}" title="إرسال تأكيد الدفع + PDF فوراً">إرسال الآن</button>`;
}

function renderTable(rows) {
  if (!rows.length) {
    paymentsBody.innerHTML = '<tr><td colspan="11" class="empty">لا توجد عمليات دفع بعد</td></tr>';
    return;
  }

  paymentsBody.innerHTML = rows
    .map((row) => {
      const product = formatProduct(row);
      const note = row.whatsapp_last_error || (row.whatsapp_sent_at ? `أُرسل: ${row.whatsapp_sent_at}` : '—');
      const waStatus = row.whatsapp_status || row.status;
      const checked = row.done ? 'checked' : '';
      return `<tr data-id="${escapeHtml(encodeURIComponent(row.id))}">
        <td class="mono">${escapeHtml(row.timestamp)}</td>
        <td>${escapeHtml(row.name || '—')}</td>
        <td class="mono small">${escapeHtml(row.email || '—')}</td>
        <td class="mono">${escapeHtml(row.phone || '—')}</td>
        <td>${escapeHtml(product)}</td>
        <td>${escapeHtml(row.payment_method || '—')}</td>
        <td class="receipt-cell">${receiptCell(row)}</td>
        <td class="toggle-cell">
          <label class="switch">
            <input type="checkbox" class="done-toggle" data-id="${escapeHtml(row.id)}" ${checked} />
            <span class="slider"></span>
          </label>
        </td>
        <td class="send-now-cell">${sendNowButton(row)}</td>
        <td>${statusBadge(waStatus)}</td>
        <td class="note" title="${escapeHtml(note)}">${escapeHtml(note)}</td>
      </tr>`;
    })
    .join('');

  paymentsBody.querySelectorAll('.done-toggle').forEach((input) => {
    input.addEventListener('change', () => onToggleDone(input));
  });
  paymentsBody.querySelectorAll('.btn-send-now').forEach((btn) => {
    btn.addEventListener('click', () => onSendNow(btn));
  });
}

async function fetchPayments() {
  const q = encodeURIComponent(searchQInput.value.trim());
  const status = encodeURIComponent(filterStatusInput.value);
  const res = await fetch(`/api/payments?q=${q}&status=${status}`, { headers: apiHeaders() });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || data.hint || 'فشل تحميل البيانات');
  }
  return data;
}

async function loadPayments() {
  paymentsBody.innerHTML = '<tr><td colspan="11" class="empty">جاري التحميل…</td></tr>';
  try {
    const data = await fetchPayments();
    const provider = data.provider || 'supabase';
    providerPill.textContent = PROVIDER_LABELS[provider] || provider;
    providerPill.className = `provider-pill provider-pill--${provider.includes('edge') ? 'edge' : 'db'}`;
    renderStats(data.stats);
    renderTable(data.rows);
    await refreshEnvBanner();
  } catch (e) {
    paymentsBody.innerHTML = `<tr><td colspan="11" class="empty error">${escapeHtml(e.message)}</td></tr>`;
    showToast(e.message, 'err');
  }
}

async function onToggleDone(input) {
  const id = input.getAttribute('data-id');
  const done = input.checked;
  const prev = !done;
  input.disabled = true;

  try {
    const res = await fetch(`/api/payments?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ done, resetWhatsapp: true })
    });
  const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل التحديث');
    }
    if (data.stats && data.rows) {
      renderStats(data.stats);
      renderTable(data.rows);
    } else {
      await loadPayments();
    }
    showToast(
      done
        ? 'تم التأكيد — اضغطي «إرسال الآن» أو انتظري الكرون (30 د)'
        : 'تم إلغاء التأكيد وإعادة ضبط واتساب'
    );
  } catch (e) {
    input.checked = prev;
    showToast(e.message, 'err');
  } finally {
    input.disabled = false;
  }
}

async function onSendNow(btn) {
  const id = btn.getAttribute('data-id');
  if (!id) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'جاري الإرسال…';

  try {
    const res = await fetch('/api/payment-send-now', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ form_timestamp: id })
    });
  const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || data.error || 'فشل الإرسال');
    }
    if (data.stats && data.rows) {
      renderStats(data.stats);
      renderTable(data.rows);
    } else {
      await loadPayments();
    }
    showToast(data.message || 'تم إرسال واتساب بنجاح');
  } catch (e) {
    showToast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function refreshEnvBanner() {
  try {
    const res = await fetch('/api/health');
    const d = await res.json();
    const connected = Boolean(d.supabaseConnected);

    envBanner.className = `env-banner ${connected ? 'env-banner--ok' : 'env-banner--warn'}`;

    if (connected) {
      envBanner.innerHTML = `
        <strong>متصل بـ Supabase</strong> — جدول <code>yassmin.payments</code>
        ${d.supabaseEdgePayments ? ' عبر Edge Function' : ''}.
        التعديلات فورية. استخدمي <strong>إرسال الآن</strong> للإرسال الفوري، أو انتظري الكرون كل <strong>30 دقيقة</strong>.
        <br><small>اللوحة: <a href="https://yassmin-whatsapp-automation.vercel.app" target="_blank" rel="noopener">yassmin-whatsapp-automation.vercel.app</a></small>`;
    } else {
      envBanner.innerHTML = `<strong>غير متصل بقاعدة البيانات</strong> — راجع متغيرات Vercel: <code>SUPABASE_URL</code> و <code>SUPABASE_PAYMENTS_FUNCTION_URL</code>.`;
    }
  } catch (e) {
    envBanner.className = 'env-banner env-banner--warn';
    envBanner.textContent = 'تعذر الاتصال بالسيرفر: ' + e.message;
  }
}

function renderMsgStats(stats) {
  if (!stats) return;
  msgStatTotal.textContent = stats.total ?? '0';
  msgStatAuto.textContent = stats.auto_replied ?? '0';
  msgStatHuman.textContent = stats.human_handoff ?? '0';
  msgStatReceived.textContent = stats.received ?? '0';
}

function renderMessagesTable(threads) {
  if (!threads.length) {
    messagesBody.innerHTML = '<tr><td colspan="6" class="empty">لا توجد محادثات بعد</td></tr>';
    return;
  }

  messagesBody.innerHTML = threads
    .map((row) => {
      const human = row.routing_mode === 'human' || row.status === 'human_handoff';
      const actionBtn = human
        ? `<button type="button" class="btn-sm btn-ok" data-action="auto" data-phone="${escapeHtml(row.phone)}">تفعيل الرد التلقائي</button>`
        : `<button type="button" class="btn-sm btn-warn" data-action="human" data-phone="${escapeHtml(row.phone)}">تحويل لرد بشري</button>`;
      const kw = row.last_keyword ? truncate(row.last_keyword, 48) : '—';
      return `<tr class="msg-thread-row" data-phone="${escapeHtml(row.phone)}" title="اضغطي لعرض سجل message_log كاملاً لهذا الرقم">
        <td class="mono">${escapeHtml(row.phone)}</td>
        <td title="${escapeHtml(row.last_inbound_text)}">${escapeHtml(truncate(row.last_inbound_text))}<br><small class="muted">${escapeHtml(formatWhen(row.last_inbound_at || row.last_message_at))}</small></td>
        <td title="${escapeHtml(row.last_reply_text)}">${escapeHtml(truncate(row.last_reply_text || '—'))}</td>
        <td class="small muted" title="${escapeHtml(row.last_keyword || '')}">${escapeHtml(kw)}</td>
        <td>${msgStatusBadge(row.status)}</td>
        <td>${actionBtn}</td>
      </tr>`;
    })
    .join('');

  messagesBody.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onRoutingAction(btn);
  });
});
  messagesBody.querySelectorAll('tr.msg-thread-row').forEach((tr) => {
    tr.addEventListener('click', () => openMessageThread(tr.getAttribute('data-phone')));
  });
}

function msgDirectionLabel(row) {
  const d = (row.direction || '').toLowerCase();
  if (d === 'outbound') return 'صادر';
  return 'وارد';
}

function msgRoutingModeLabel(row) {
  const r = String(row.routing_mode || 'auto').toLowerCase();
  if (r === 'human') return 'بشري (متوقف)';
  return 'تلقائي';
}

function renderRecentMessages(rows) {
  if (!rows.length) {
    recentMessagesBody.innerHTML = '<tr><td colspan="8" class="empty">لا يوجد سجل message_log بعد — تأكدي أن n8n يستدعي <code>ingest/message</code>.</td></tr>';
    return;
  }

  recentMessagesBody.innerHTML = rows
    .map((row) => {
      const status = row.status || (row.reply_sent ? 'auto_replied' : 'received');
      const inbound = row.message ? truncate(row.message, 56) : '—';
      const outbound = row.reply_sent ? truncate(row.reply_sent, 56) : '—';
      const kw = row.keyword_matched ? truncate(String(row.keyword_matched), 40) : '—';
      const phone = String(row.phone || '').trim();
      const phoneAttr = escapeHtml(phone);
      return `<tr class="msg-log-row" data-phone="${phoneAttr}" title="اضغطي لفتح سجل المحادثة لهذا الرقم">
        <td class="mono small">${escapeHtml(formatWhen(row.logged_at || row.timestamp))}</td>
        <td class="mono">${phoneAttr ? phoneAttr : '—'}</td>
        <td class="small muted">${escapeHtml(msgDirectionLabel(row))}</td>
        <td title="${escapeHtml(row.message)}">${escapeHtml(inbound)}</td>
        <td class="small" title="${escapeHtml(row.keyword_matched || '')}">${escapeHtml(kw)}</td>
        <td title="${escapeHtml(row.reply_sent)}">${escapeHtml(outbound)}</td>
        <td class="small muted">${escapeHtml(msgRoutingModeLabel(row))}</td>
        <td>${msgStatusBadge(status)}</td>
      </tr>`;
    })
    .join('');
}

function wireRecentMessageLogRows() {
  if (!recentMessagesBody) return;
  recentMessagesBody.querySelectorAll('tr.msg-log-row[data-phone]').forEach((tr) => {
    const phone = tr.getAttribute('data-phone');
    if (!phone) return;
    tr.addEventListener('click', () => openMessageThread(phone));
  });
}

async function fetchMessages() {
  const q = encodeURIComponent(msgSearchQInput.value.trim());
  const status = encodeURIComponent(msgFilterStatusInput.value);
  const res = await fetch(`/api/messages?q=${q}&status=${status}`, { headers: apiHeaders() });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || data.hint || 'فشل تحميل الرسائل');
  }
  return data;
}

async function openMessageThread(phone) {
  if (!phone || !threadPanel || !threadBubblesEl) return;
  threadPhoneEl.textContent = phone;
  threadBubblesEl.innerHTML = '<p class="empty muted">جاري التحميل…</p>';
  threadPanel.classList.remove('hidden');
  threadPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const res = await fetch(`/api/messages-thread?phone=${encodeURIComponent(phone)}`, {
      headers: apiHeaders()
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل تحميل المحادثة');
    }
    renderMessageThreadBubbles(data.messages || []);
  } catch (e) {
    threadBubblesEl.innerHTML = `<p class="empty error">${escapeHtml(e.message)}</p>`;
  }
}

function renderMessageThreadBubbles(messages) {
  if (!messages.length) {
    threadBubblesEl.innerHTML =
      '<p class="empty muted">لا يوجد سجل بعد. تأكدي أن workflow البوت يستدعي <code>ingest/message</code> أو جرّبي «إرسال الآن» من الدفعات.</p>';
    return;
  }
  const parts = [];
  for (const row of messages) {
    const t = formatWhen(row.logged_at);
    const msg = String(row.message || '').trim();
    const reply = String(row.reply_sent || '').trim();
    const routeHint = row.routing_mode === 'human' ? ' · توجيه بشري' : '';
    if (msg) {
      parts.push(
        `<div class="thread-bubble thread-bubble--in"><div class="thread-bubble-meta">${escapeHtml(t)} · وارد${row.keyword_matched ? ` · ${escapeHtml(row.keyword_matched)}` : ''}${escapeHtml(routeHint)}</div><div class="thread-bubble-text">${escapeHtml(msg)}</div></div>`
      );
    }
    if (reply) {
      parts.push(
        `<div class="thread-bubble thread-bubble--out"><div class="thread-bubble-meta">${escapeHtml(t)} · صادر · ${escapeHtml(row.status || '—')}</div><div class="thread-bubble-text">${escapeHtml(reply)}</div></div>`
      );
    }
  }
  threadBubblesEl.innerHTML = parts.length ? parts.join('') : '<p class="empty muted">لا نصوص مسجّلة</p>';
}

const PAUSED_REASON_LABELS = {
  human_handoff: 'رد من واتساب الأعمال',
  human_reply: 'رد بشري',
  dashboard_manual: 'من اللوحة يدوياً'
};

function renderPausedChats(rows) {
  if (!pausedChatsBody) return;
  if (!rows.length) {
    pausedChatsBody.innerHTML =
      '<tr><td colspan="5" class="empty">لا أرقام موقوفة حالياً — يمكن إرسال تأكيد الدفع لأي رقم غير مدرج هنا.</td></tr>';
    return;
  }
  pausedChatsBody.innerHTML = rows
    .map((row) => {
      const phone = escapeHtml(row.phone || '');
      const reasonKey = String(row.reason || '').trim();
      const reason =
        PAUSED_REASON_LABELS[reasonKey] || (reasonKey ? escapeHtml(reasonKey) : '—');
      return `<tr>
        <td class="mono">${phone}</td>
        <td class="mono small">${escapeHtml(formatWhen(row.last_human_at || row.paused_at))}</td>
        <td class="mono small">${escapeHtml(formatWhen(row.expires_at))}</td>
        <td class="small muted">${reason}</td>
        <td><button type="button" class="btn-sm btn-ok" data-action="auto" data-phone="${phone}">تفعيل الرد التلقائي</button></td>
      </tr>`;
    })
    .join('');
  pausedChatsBody.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => onRoutingAction(btn));
  });
}

async function loadPausedChats() {
  if (!pausedChatsBody) return;
  pausedChatsBody.innerHTML = '<tr><td colspan="5" class="empty">جاري التحميل…</td></tr>';
  try {
    const res = await fetch('/api/paused-chats', { headers: apiHeaders() });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل تحميل الأرقام الموقوفة');
    }
    renderPausedChats(data.rows || []);
  } catch (e) {
    pausedChatsBody.innerHTML = `<tr><td colspan="5" class="empty error">${escapeHtml(e.message)}</td></tr>`;
  }
}

async function loadMessages() {
  messagesBody.innerHTML = '<tr><td colspan="6" class="empty">جاري التحميل…</td></tr>';
  loadPausedChats();
  try {
    const data = await fetchMessages();
    const provider = data.provider || 'supabase';
    providerPill.textContent = PROVIDER_LABELS[provider] || provider;
    providerPill.className = `provider-pill provider-pill--${provider.includes('edge') ? 'edge' : 'db'}`;
    renderMsgStats(data.stats);
    renderMessagesTable(data.threads || []);
    renderRecentMessages(data.recent_messages || []);
    wireRecentMessageLogRows();
  } catch (e) {
    messagesBody.innerHTML = `<tr><td colspan="6" class="empty error">${escapeHtml(e.message)}</td></tr>`;
    showToast(e.message, 'err');
  }
}

async function onRoutingAction(btn) {
  const phone = btn.getAttribute('data-phone');
  const mode = btn.getAttribute('data-action') === 'human' ? 'human' : 'auto';
  btn.disabled = true;
  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(phone)}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ mode, reason: 'dashboard_manual' })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل التحديث');
    }
    showToast(data.message || (mode === 'human' ? 'تم التحويل للرد البشري' : 'تم تفعيل الرد التلقائي'));
    await loadPausedChats();
    if (data.stats && data.threads) {
      renderMsgStats(data.stats);
      renderMessagesTable(data.threads);
    } else {
      await loadMessages();
    }
  } catch (e) {
    showToast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

async function loadKeywords() {
  if (!keywordsBody) return;
  keywordsBody.innerHTML = '<tr><td colspan="5" class="empty">جاري التحميل…</td></tr>';
  try {
    const res = await fetch('/api/keywords', { headers: apiHeaders() });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل تحميل الردود');
    }
    keywordsCache = data.keywords || [];
    renderKeywordsTable(keywordsCache);
  } catch (e) {
    keywordsBody.innerHTML = `<tr><td colspan="5" class="empty error">${escapeHtml(e.message)}</td></tr>`;
    showToast(e.message, 'err');
  }
}

function renderKeywordsTable(rows) {
  if (!keywordsBody) return;
  if (!rows.length) {
    keywordsBody.innerHTML =
      '<tr><td colspan="5" class="empty">لا توجد قواعد بعد — أضيفي صف «default» كرد احتياطي.</td></tr>';
    return;
  }
  keywordsBody.innerHTML = rows
    .map((row) => {
      const id = escapeHtml(row.id);
      const ord = Number(row.sort_order) || 0;
      const active = row.active !== false;
      const kwRaw = row.keyword || '';
      const repRaw = row.reply || '';
      const kwPrev = escapeHtml(keywordPreviewText(kwRaw, 96));
      const repPrev = escapeHtml(keywordPreviewText(repRaw, 140));
      const titleKw = escapeAttr(kwRaw.slice(0, 500));
      const titleRep = escapeAttr(repRaw.slice(0, 500));
      return `<tr data-kw-id="${id}">
        <td class="kw-order-cell"><span class="kw-order-pill" title="يُعدّل من نافذة التعديل">${ord}</span></td>
        <td><input type="checkbox" class="kw-active-toggle" data-id="${id}" ${active ? 'checked' : ''} aria-label="مفعّل" /></td>
        <td class="kw-preview-cell"><p class="kw-preview" title="${titleKw}">${kwPrev || '—'}</p></td>
        <td class="kw-preview-cell"><p class="kw-preview" title="${titleRep}">${repPrev || '—'}</p></td>
        <td class="kw-actions-cell">
          <div class="kw-row-actions">
            <button type="button" class="btn-sm btn-kw-edit btn-primary" data-id="${id}">تعديل</button>
            <button type="button" class="btn-sm btn-kw-del danger-text" data-id="${id}">حذف</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

function openKeywordModal(id) {
  if (!kwEditModal || !id) return;
  const row = keywordsCache.find((x) => String(x.id) === String(id));
  if (!row) {
    showToast('تعذر العثور على القاعدة — حدّثي القائمة', 'err');
    return;
  }
  kwEditId.value = id;
  kwEditOrder.value = Number(row.sort_order) || 0;
  kwEditActive.checked = row.active !== false;
  kwEditKeyword.value = row.keyword || '';
  kwEditReply.value = row.reply || '';
  kwEditModal.classList.remove('hidden');
  kwEditModal.setAttribute('aria-hidden', 'false');
  kwEditKeyword.focus();
}

function closeKeywordModal() {
  if (!kwEditModal) return;
  kwEditModal.classList.add('hidden');
  kwEditModal.setAttribute('aria-hidden', 'true');
}

async function onToggleKeywordActive(inputEl, id, active) {
  if (!id || !inputEl) return;
  inputEl.disabled = true;
  try {
    const res = await fetch(`/api/keywords?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ active })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل التحديث');
    }
    const r = keywordsCache.find((x) => String(x.id) === String(id));
    if (r) r.active = active;
    showToast(active ? 'تم التفعيل' : 'تم الإيقاف المؤقت');
  } catch (e) {
    inputEl.checked = !active;
    showToast(e.message, 'err');
  } finally {
    inputEl.disabled = false;
  }
}

async function saveKeywordFromModal() {
  const id = kwEditId?.value;
  if (!id || !kwEditSave) return;
  const body = {
    sort_order: Number(kwEditOrder?.value) || 0,
    active: kwEditActive?.checked !== false,
    keyword: String(kwEditKeyword?.value ?? '').trim(),
    reply: String(kwEditReply?.value ?? '').trim()
  };
  if (!body.keyword || !body.reply) {
    showToast('أدخل كلمات التشغيل والنص', 'err');
    return;
  }
  kwEditSave.disabled = true;
  try {
    const res = await fetch(`/api/keywords?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل الحفظ');
    }
    showToast('تم حفظ القاعدة');
    closeKeywordModal();
    await loadKeywords();
  } catch (e) {
    showToast(e.message, 'err');
  } finally {
    kwEditSave.disabled = false;
  }
}

async function onDeleteKeyword(id) {
  if (!id || !confirm('حذف هذه القاعدة؟')) return;
  try {
    const res = await fetch(`/api/keywords?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: apiHeaders()
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل الحذف');
    }
    showToast('تم الحذف');
    if (kwEditId?.value === id) closeKeywordModal();
    await loadKeywords();
  } catch (e) {
    showToast(e.message, 'err');
  }
}

keywordsBody?.addEventListener('click', (e) => {
  const editBtn = e.target.closest('.btn-kw-edit');
  if (editBtn) {
    openKeywordModal(editBtn.getAttribute('data-id'));
    return;
  }
  const delBtn = e.target.closest('.btn-kw-del');
  if (delBtn) {
    onDeleteKeyword(delBtn.getAttribute('data-id'));
  }
});

keywordsBody?.addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList?.contains('kw-active-toggle')) {
    onToggleKeywordActive(t, t.getAttribute('data-id'), t.checked);
  }
});

async function onAddKeyword() {
  if (!kwAddBtn) return;
  const sort_order = Number(kwNewOrder?.value) || 0;
  const active = kwNewActive?.checked !== false;
  const keyword = String(kwNewTrigger?.value ?? '').trim();
  const reply = String(kwNewReply?.value ?? '').trim();
  if (!keyword || !reply) {
    showToast('أدخل كلمات التشغيل والنص', 'err');
    return;
  }
  kwAddBtn.disabled = true;
  try {
    const res = await fetch('/api/keywords', {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ keyword, reply, active, sort_order })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'فشل الإضافة');
    }
    showToast('تمت الإضافة');
    kwNewTrigger.value = '';
    kwNewReply.value = '';
    kwNewOrder.value = '0';
    await loadKeywords();
  } catch (e) {
    showToast(e.message, 'err');
  } finally {
    kwAddBtn.disabled = false;
  }
}

function setView(view) {
  if (view !== 'keywords') closeKeywordModal();
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');

  const titles = {
    payments: 'عمليات الدفع',
    messages: 'رسائل واتساب',
    keywords: 'ردود البوت (كلمات مفتاحية)',
    operations: 'تحكم الأتمتة'
  };
  document.getElementById('viewTitle').textContent = titles[view] || 'Yassmin Ops';
  document.getElementById('viewSubtitle').style.display = view === 'payments' ? '' : 'none';

  const paymentsOn = view === 'payments';
  refreshPaymentsBtn.classList.toggle('hidden', !paymentsOn);
  refreshMessagesBtn?.classList.toggle('hidden', view !== 'messages');
  refreshKeywordsBtn?.classList.toggle('hidden', view !== 'keywords');

  if (view === 'payments') loadPayments();
  if (view === 'messages') loadMessages();
  if (view === 'keywords') loadKeywords();
}

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (!document.getElementById('view-payments').classList.contains('hidden')) loadPayments();
    if (!document.getElementById('view-messages').classList.contains('hidden')) loadMessages();
    if (!document.getElementById('view-keywords')?.classList.contains('hidden')) loadKeywords();
  }, 60_000);
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.getAttribute('data-view')));
});

document.getElementById('refreshPayments').addEventListener('click', loadPayments);
refreshMessagesBtn?.addEventListener('click', loadMessages);
refreshKeywordsBtn?.addEventListener('click', loadKeywords);
kwAddBtn?.addEventListener('click', onAddKeyword);
kwEditModal?.addEventListener('click', (e) => {
  if (e.target === kwEditModal) closeKeywordModal();
});
kwEditSave?.addEventListener('click', saveKeywordFromModal);
kwEditCancel?.addEventListener('click', closeKeywordModal);
kwEditCloseX?.addEventListener('click', closeKeywordModal);
kwEditDelete?.addEventListener('click', () => {
  const id = kwEditId?.value;
  if (id) onDeleteKeyword(id);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (kwEditModal && !kwEditModal.classList.contains('hidden')) closeKeywordModal();
});
closeThreadPanelBtn?.addEventListener('click', () => {
  threadPanel?.classList.add('hidden');
});

msgSearchQInput?.addEventListener('input', () => {
  clearTimeout(msgSearchDebounce);
  msgSearchDebounce = setTimeout(loadMessages, 350);
});
msgFilterStatusInput?.addEventListener('change', loadMessages);

searchQInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadPayments, 350);
});
filterStatusInput.addEventListener('change', loadPayments);

async function postControl(payload) {
  if (dryRunInput.checked) {
    resultOutput.textContent = JSON.stringify({ dryRun: true, payload }, null, 2);
    return;
  }
  const res = await fetch('/api/control', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, error: 'invalid_json', status: res.status, raw: text.slice(0, 200) };
  }
  resultOutput.textContent = JSON.stringify(data, null, 2);
  await fetchHistory();
}

document.querySelectorAll('button[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => postControl({ action: btn.getAttribute('data-action') }));
});
document.getElementById('emergencyPause').addEventListener('click', () =>
  postControl({ action: 'pause', mode: 'emergency', reason: 'manual_kill_switch' })
);
document.getElementById('retryFailed').addEventListener('click', () =>
  postControl({
    action: 'retry_failed',
    filter: { whatsapp_status: retryStatusInput.value, dead_letter: retryStatusInput.value === 'dead_letter' }
  })
);

async function fetchHistory() {
  const res = await fetch('/api/control');
  const text = await res.text();
  if (!res.ok) {
    historyOutput.textContent = JSON.stringify(
      { ok: false, error: 'history_unavailable', status: res.status, detail: text.slice(0, 120) },
      null,
      2
    );
    return;
  }
  let data;
  try {
    data = text ? JSON.parse(text) : { ok: true, items: [] };
  } catch {
    data = { ok: false, error: 'invalid_json', raw: text.slice(0, 200) };
  }
  historyOutput.textContent = JSON.stringify(data, null, 2);
}

document.getElementById('refreshHistory').addEventListener('click', fetchHistory);

loadPayments();
fetchHistory();
startAutoRefresh();
