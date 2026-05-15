const form = document.getElementById('paymentForm');
const productSelect = document.getElementById('product_code');
const paymentMethodSelect = document.getElementById('payment_method');
const localPayBox = document.getElementById('localPayBox');
const copyPhoneBtn = document.getElementById('copyPhoneBtn');
const submitBtn = document.getElementById('submitBtn');
const formError = document.getElementById('formError');
const formSuccess = document.getElementById('formSuccess');
const successMsg = document.getElementById('successMsg');

const PAY_LOCAL = 'فودافون كاش/انستا باي';
const PAY_PHONE = '01090321007';
const MAX_FILE = 4 * 1024 * 1024;

function updatePaymentInstructions() {
  const method = paymentMethodSelect.value;
  const showLocal = method === PAY_LOCAL;
  localPayBox.classList.toggle('hidden', !showLocal);
}

paymentMethodSelect.addEventListener('change', updatePaymentInstructions);

copyPhoneBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(PAY_PHONE);
    copyPhoneBtn.textContent = 'تم النسخ';
    setTimeout(() => {
      copyPhoneBtn.textContent = 'نسخ';
    }, 2000);
  } catch {
    copyPhoneBtn.textContent = PAY_PHONE;
  }
});

function showError(msg) {
  formError.textContent = msg;
  formError.classList.remove('hidden');
}

function hideError() {
  formError.classList.add('hidden');
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

async function loadProducts() {
  try {
    const res = await fetch('/api/public/products');
    const data = await res.json();
    const products = data.products || [];
    productSelect.innerHTML = '<option value="">اختر المنتج…</option>';
    for (const p of products) {
      const opt = document.createElement('option');
      opt.value = p.product_code;
      opt.textContent = p.label_ar || p.product_code;
      productSelect.appendChild(opt);
    }
  } catch {
    productSelect.innerHTML = `
      <option value="">اختر المنتج…</option>
      <option value="inner_compass">كتاب بوصلتك الداخلية</option>
      <option value="voltaren_social">كتاب فولتارين السوشيال ميديا</option>`;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  submitBtn.disabled = true;
  submitBtn.textContent = 'جاري الإرسال…';

  try {
    const fd = new FormData(form);
    const file = document.getElementById('receipt').files[0];
    if (!file) {
      showError('يرجى رفع صورة الإيصال.');
      return;
    }
    if (file.size > MAX_FILE) {
      showError('حجم الملف كبير جدًا (الحد 4 ميجا).');
      return;
    }

    const receipt_base64 = await readFileAsBase64(file);
    const selected = productSelect.selectedOptions[0];

    const payload = {
      name: fd.get('name'),
      email: fd.get('email'),
      payment_method: fd.get('payment_method'),
      phone: fd.get('phone'),
      phone_alt: fd.get('phone_alt'),
      product_code: fd.get('product_code'),
      product_label: fd.get('product_label') || selected?.textContent || '',
      receipt_base64,
      receipt_mime: file.type || 'application/octet-stream',
      website: fd.get('website')
    };

    const res = await fetch('/api/public/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      const msgs = {
        name_required: 'الاسم مطلوب',
        email_invalid: 'البريد الإلكتروني غير صالح',
        phone_invalid: 'رقم الواتساب غير صالح',
        product_required: 'اختر المنتج',
        payment_method_required: 'اختر طريقة الدفع',
        duplicate_submission: 'تم إرسال هذا الطلب مسبقًا',
        receipt_too_large: 'صورة الإيصال كبيرة جدًا (حد أقصى 4 ميجا)',
        receipt_required: 'يرجى رفع صورة الإيصال',
        receipt_upload_failed: 'تعذر حفظ صورة الإيصال — حاولي مرة أخرى',
        payment_insert_failed: 'تعذر حفظ الطلب — تأكدي من إعدادات السيرفر أو حاولي لاحقًا',
        unauthorized: 'السيرفر رفض الطلب — راجع إعدادات Supabase Edge',
        validation_failed: 'بيانات غير مكتملة'
      };
      const key = (data.error || '').split(',')[0];
      showError(data.message || msgs[key] || data.error || 'تعذر الإرسال، حاولي مرة أخرى.');
      return;
    }

    form.classList.add('hidden');
    formSuccess.classList.remove('hidden');
    successMsg.textContent = data.message || 'شكرًا! سيُراجع الطلب ويُرسل المنتج على واتساب بعد التأكيد.';
  } catch (err) {
    showError('تعذر الاتصال بالسيرفر. تحققي من الاتصال وحاولي مرة أخرى.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'إرسال الطلب';
  }
});

document.getElementById('sendAnother').addEventListener('click', () => {
  form.reset();
  form.classList.remove('hidden');
  formSuccess.classList.add('hidden');
  hideError();
  updatePaymentInstructions();
  loadProducts();
});

loadProducts();
