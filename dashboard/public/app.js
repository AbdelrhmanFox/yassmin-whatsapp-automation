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
const msgStatTotal = document.getElementById('msgStatTotal');
const msgStatAuto = document.getElementById('msgStatAuto');
const msgStatHuman = document.getElementById('msgStatHuman');
const msgStatReceived = document.getElementById('msgStatReceived');
const refreshPaymentsBtn = document.getElementById('refreshPayments');
const refreshMessagesBtn = document.getElementById('refreshMessages');

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
  'supabase-edge': 'Supabase Edge',
  sheets: 'Google Sheets'
};

const MSG_STATUS_LABELS = {
  received: 'رسالة واردة',
  auto_replied: 'رد تلقائي',
  human_handoff: 'تحويل لرد بشري'
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
    const res = await fetch(`/api/payments/${encodeURIComponent(id)}`, {
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
    const provider = d.databaseProvider || '—';
    const connected = d.supabaseConnected || d.sheetsConnected;

    envBanner.className = `env-banner ${connected ? 'env-banner--ok' : 'env-banner--warn'}`;

    if (connected && provider === 'supabase') {
      envBanner.innerHTML = `
        <strong>متصل بـ Supabase</strong> — جدول <code>yassmin.payments</code>
        ${d.supabaseEdgePayments ? ' عبر Edge Function' : ''}.
        التعديلات فورية. استخدمي <strong>إرسال الآن</strong> للإرسال الفوري، أو انتظري الكرون كل <strong>30 دقيقة</strong>.
        <br><small>اللوحة: <a href="https://yassmin-whatsapp-automation.vercel.app" target="_blank" rel="noopener">yassmin-whatsapp-automation.vercel.app</a></small>`;
    } else if (connected && provider === 'sheets') {
      envBanner.innerHTML = `<strong>متصل بـ Google Sheets</strong> — التعديلات تُكتب في عمود <code>done</code>.`;
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
    messagesBody.innerHTML = '<tr><td colspan="5" class="empty">لا توجد محادثات بعد</td></tr>';
    return;
  }

  messagesBody.innerHTML = threads
    .map((row) => {
      const human = row.routing_mode === 'human' || row.status === 'human_handoff';
      const actionBtn = human
        ? `<button type="button" class="btn-sm btn-ok" data-action="auto" data-phone="${escapeHtml(row.phone)}">تفعيل الرد التلقائي</button>`
        : `<button type="button" class="btn-sm btn-warn" data-action="human" data-phone="${escapeHtml(row.phone)}">تحويل لرد بشري</button>`;
      return `<tr data-phone="${escapeHtml(row.phone)}">
        <td class="mono">${escapeHtml(row.phone)}</td>
        <td title="${escapeHtml(row.last_inbound_text)}">${escapeHtml(truncate(row.last_inbound_text))}<br><small class="muted">${escapeHtml(formatWhen(row.last_inbound_at || row.last_message_at))}</small></td>
        <td title="${escapeHtml(row.last_reply_text)}">${escapeHtml(truncate(row.last_reply_text || '—'))}</td>
        <td>${msgStatusBadge(row.status)}</td>
        <td>${actionBtn}</td>
      </tr>`;
    })
    .join('');

  messagesBody.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => onRoutingAction(btn));
  });
}

function renderRecentMessages(rows) {
  if (!rows.length) {
    recentMessagesBody.innerHTML = '<tr><td colspan="5" class="empty">لا أحداث بعد</td></tr>';
    return;
  }

  recentMessagesBody.innerHTML = rows
    .map((row) => {
      const status = row.status || (row.reply_sent ? 'auto_replied' : 'received');
      return `<tr>
        <td class="mono small">${escapeHtml(formatWhen(row.logged_at || row.timestamp))}</td>
        <td class="mono">${escapeHtml(row.phone || '—')}</td>
        <td title="${escapeHtml(row.message)}">${escapeHtml(truncate(row.message))}</td>
        <td>${escapeHtml(row.keyword_matched || '—')}</td>
        <td>${msgStatusBadge(status)}</td>
      </tr>`;
    })
    .join('');
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

async function loadMessages() {
  messagesBody.innerHTML = '<tr><td colspan="5" class="empty">جاري التحميل…</td></tr>';
  try {
    const data = await fetchMessages();
    const provider = data.provider || 'supabase';
    providerPill.textContent = PROVIDER_LABELS[provider] || provider;
    providerPill.className = `provider-pill provider-pill--${provider.includes('edge') ? 'edge' : 'db'}`;
    renderMsgStats(data.stats);
    renderMessagesTable(data.threads || []);
    renderRecentMessages(data.recent_messages || []);
  } catch (e) {
    messagesBody.innerHTML = `<tr><td colspan="5" class="empty error">${escapeHtml(e.message)}</td></tr>`;
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

function setView(view) {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`view-${view}`).classList.remove('hidden');

  const titles = {
    payments: 'عمليات الدفع',
    messages: 'رسائل واتساب',
    operations: 'تحكم الأتمتة'
  };
  document.getElementById('viewTitle').textContent = titles[view] || 'Yassmin Ops';
  document.getElementById('viewSubtitle').style.display = view === 'payments' ? '' : 'none';

  const paymentsOn = view === 'payments';
  refreshPaymentsBtn.classList.toggle('hidden', !paymentsOn);
  refreshMessagesBtn?.classList.toggle('hidden', view !== 'messages');

  if (view === 'payments') loadPayments();
  if (view === 'messages') loadMessages();
}

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (!document.getElementById('view-payments').classList.contains('hidden')) loadPayments();
    if (!document.getElementById('view-messages').classList.contains('hidden')) loadMessages();
  }, 60_000);
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.getAttribute('data-view')));
});

document.getElementById('refreshPayments').addEventListener('click', loadPayments);
refreshMessagesBtn?.addEventListener('click', loadMessages);

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
  const res = await fetch('/api/history');
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
