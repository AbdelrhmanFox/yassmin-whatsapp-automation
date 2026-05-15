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

let searchDebounce;
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

function formatProduct(row) {
  if (row.product_label && row.product_code) {
    return `${row.product_label} (${row.product_code})`;
  }
  return row.product_label || row.product_code || '—';
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
    paymentsBody.innerHTML = '<tr><td colspan="9" class="empty">لا توجد عمليات دفع بعد</td></tr>';
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
        <td class="toggle-cell">
          <label class="switch">
            <input type="checkbox" class="done-toggle" data-id="${escapeHtml(row.id)}" ${checked} />
            <span class="slider"></span>
          </label>
        </td>
        <td>${statusBadge(waStatus)}</td>
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
  paymentsBody.innerHTML = '<tr><td colspan="9" class="empty">جاري التحميل…</td></tr>';
  try {
    const data = await fetchPayments();
    const provider = data.provider || 'supabase';
    providerPill.textContent = PROVIDER_LABELS[provider] || provider;
    providerPill.className = `provider-pill provider-pill--${provider.includes('edge') ? 'edge' : 'db'}`;
    renderStats(data.stats);
    renderTable(data.rows);
    await refreshEnvBanner();
  } catch (e) {
    paymentsBody.innerHTML = `<tr><td colspan="9" class="empty error">${escapeHtml(e.message)}</td></tr>`;
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
    showToast(done ? 'تم تفعيل التأكيد — سيرسل واتساب في أقرب كرون (30 د)' : 'تم إلغاء التأكيد وإعادة ضبط واتساب');
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
    const provider = d.databaseProvider || '—';
    const connected = d.supabaseConnected || d.sheetsConnected;

    envBanner.className = `env-banner ${connected ? 'env-banner--ok' : 'env-banner--warn'}`;

    if (connected && provider === 'supabase') {
      envBanner.innerHTML = `
        <strong>متصل بـ Supabase</strong> — جدول <code>yassmin.payments</code>
        ${d.supabaseEdgePayments ? ' عبر Edge Function' : ''}.
        التعديلات فورية؛ n8n يقرأ الصفوف المؤكدة كل <strong>30 دقيقة</strong> ويرسل واتساب + PDF.
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

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (document.getElementById('view-payments').classList.contains('hidden')) return;
    loadPayments();
  }, 60_000);
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.getAttribute('data-view');
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById('viewTitle').textContent =
      view === 'payments' ? 'عمليات الدفع' : 'تحكم الأتمتة';
    document.getElementById('viewSubtitle').style.display = view === 'payments' ? '' : 'none';
    if (view === 'payments') loadPayments();
  });
});

document.getElementById('refreshPayments').addEventListener('click', loadPayments);

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

loadPayments();
fetchHistory();
startAutoRefresh();
