const tokenInput = document.getElementById('token');
const dryRunInput = document.getElementById('dryRun');
const retryStatusInput = document.getElementById('retryStatus');
const searchQInput = document.getElementById('searchQ');
const filterStatusInput = document.getElementById('filterStatus');
const envBanner = document.getElementById('envBanner');
const paymentsBody = document.getElementById('paymentsBody');
const toastEl = document.getElementById('toast');
const resultOutput = document.getElementById('resultOutput');
const historyOutput = document.getElementById('historyOutput');

const statTotal = document.getElementById('statTotal');
const statPending = document.getElementById('statPending');
const statAwaiting = document.getElementById('statAwaiting');
const statSent = document.getElementById('statSent');
const statFailed = document.getElementById('statFailed');

const STATUS_LABELS = {
  pending_review: 'بانتظار المراجعة',
  awaiting_whatsapp: 'مؤكد — بانتظار واتساب',
  sent: 'تم الإرسال',
  failed: 'فشل',
  dead_letter: 'Dead letter',
  confirmed: 'مؤكد'
};

let searchDebounce;

function loadToken() {
  tokenInput.value = localStorage.getItem('dashboardAdminToken') || '';
}

function saveToken() {
  localStorage.setItem('dashboardAdminToken', tokenInput.value.trim());
}

function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const t = tokenInput.value.trim() || localStorage.getItem('dashboardAdminToken') || '';
  if (t) h['x-admin-token'] = t;
  return h;
}

function requireTokenForWrite() {
  const t = tokenInput.value.trim() || localStorage.getItem('dashboardAdminToken') || '';
  if (!t) {
    showToast('أدخلي توكن المسؤول (DASHBOARD_ADMIN_TOKEN) في الأعلى', 'err');
    return false;
  }
  return true;
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
  const label = STATUS_LABELS[status] || status;
  return `<span class="badge badge--${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function renderStats(stats) {
  if (!stats) return;
  statTotal.textContent = stats.total ?? '0';
  statPending.textContent = stats.pending_review ?? '0';
  statAwaiting.textContent = stats.awaiting_whatsapp ?? '0';
  statSent.textContent = stats.sent ?? '0';
  statFailed.textContent = (stats.failed ?? 0) + (stats.dead_letter ?? 0);
}

function renderTable(rows) {
  if (!rows.length) {
    paymentsBody.innerHTML = '<tr><td colspan="7" class="empty">لا توجد صفوف مطابقة</td></tr>';
    return;
  }

  paymentsBody.innerHTML = rows
    .map((row) => {
      const product = row.product_code || row.product_label || '—';
      const note = row.whatsapp_last_error || '—';
      const checked = row.done ? 'checked' : '';
      return `<tr data-id="${escapeHtml(encodeURIComponent(row.id))}">
        <td class="mono">${escapeHtml(row.timestamp)}</td>
        <td>${escapeHtml(row.name || '—')}</td>
        <td class="mono">${escapeHtml(row.phone || '—')}</td>
        <td>${escapeHtml(product)}</td>
        <td class="toggle-cell">
          <label class="switch">
            <input type="checkbox" class="done-toggle" data-id="${escapeHtml(row.id)}" ${checked} />
            <span class="slider"></span>
          </label>
        </td>
        <td>${statusBadge(row.whatsapp_status || row.status)}</td>
        <td class="note" title="${escapeHtml(note)}">${escapeHtml(note)}</td>
      </tr>`;
    })
    .join('');

  paymentsBody.querySelectorAll('.done-toggle').forEach((input) => {
    input.addEventListener('change', () => onToggleDone(input));
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
  paymentsBody.innerHTML = '<tr><td colspan="7" class="empty">جاري التحميل…</td></tr>';
  try {
    const data = await fetchPayments();
    renderStats(data.stats);
    renderTable(data.rows);
    await refreshEnvBanner();
  } catch (e) {
    paymentsBody.innerHTML = `<tr><td colspan="7" class="empty error">${escapeHtml(e.message)}</td></tr>`;
    showToast(e.message, 'err');
  }
}

async function onToggleDone(input) {
  if (!requireTokenForWrite()) {
    input.checked = !input.checked;
    return;
  }
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
    renderStats(data.stats);
    renderTable(data.rows);
    showToast(done ? 'تم تفعيل تأكيد الدفع — سيرسل واتساب في أقرب كرون' : 'تم إلغاء التأكيد وإعادة ضبط حالة واتساب');
  } catch (e) {
    input.checked = prev;
    showToast(e.message, 'err');
  } finally {
    input.disabled = false;
  }
}

async function refreshEnvBanner() {
  try {
    const res = await fetch('/api/health');
    const d = await res.json();
    const sheetsOk = d.sheetsConnected;
    envBanner.className = `env-banner ${sheetsOk ? 'env-banner--ok' : 'env-banner--warn'}`;
    envBanner.innerHTML = sheetsOk
      ? `<strong>متصل بـ Google Sheets</strong> — التعديلات تُكتب مباشرة في عمود <code>done</code>. الـ workflow يلتقطها كل 30 دقيقة.`
      : `<strong>غير متصل</strong> — من مجلد المشروع شغّلي: <code>npm run sync:google-sheets</code> ثم أعيدي تشغيل اللوحة.`;
  } catch (e) {
    envBanner.className = 'env-banner env-banner--warn';
    envBanner.textContent = 'تعذر الاتصال بالسيرفر: ' + e.message;
  }
}

/* Navigation */
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.getAttribute('data-view');
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById('viewTitle').textContent =
      view === 'payments' ? 'عمليات الدفع' : 'تحكم الأتمتة';
  });
});

document.getElementById('refreshPayments').addEventListener('click', () => {
  saveToken();
  loadPayments();
});

searchQInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadPayments, 350);
});
filterStatusInput.addEventListener('change', loadPayments);
tokenInput.addEventListener('change', saveToken);

/* Operations (legacy control) */
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
  const data = await res.json();
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
  const data = await res.json();
  historyOutput.textContent = JSON.stringify(data, null, 2);
}

document.getElementById('refreshHistory').addEventListener('click', fetchHistory);

loadToken();
loadPayments();
fetchHistory();
