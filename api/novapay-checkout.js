// api/novapay-checkout.js
// Called from the frontend checkout modal when the customer chooses "Оплатити карткою".
// Creates a NovaPay session, then a payment, and returns the redirect URL.

const { novaPayRequest } = require('./_novapay');

// Серверний прайс — джерело правди для суми оплати.
// Ціни з браузера ігноруються (їх можна підмінити). Тримати в синхроні з PRODUCTS в index.html.
const PRICES = {
  sleep:  { name: 'Sleep Aid Tea', price: 440 },
  calm:   { name: 'Keep Calm Tea', price: 440 },
  women:  { name: 'Raw Herbs for Women', price: 440 },
  bundle: { name: 'Набір "Herbs for Health" (3 чаї)', price: 1200, set: true },
  duo:    { name: 'Набір "День і Ніч" (Sleep Aid + Keep Calm)', price: 790, set: true },
  course: { name: 'Курс "День і Ніч" 7 тижнів (2× Sleep Aid + 2× Keep Calm)', price: 1490, set: true }
};
// Промокоди: % знижки лише на окремі чаї (не на набори). Тримати в синхроні з VALID_PROMOS в index.html.
const PROMOS = { REGINA: 20, YANA: 20, OKSANA: 20 };

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const merchantId = process.env.NOVAPAY_MERCHANT_ID;
    if (!merchantId) throw new Error('NOVAPAY_MERCHANT_ID env var is not set');

    const siteUrl = process.env.SITE_URL || 'https://leckar.com.ua';

    const body = req.body || {};
    const {
      name,
      phone,
      city,
      delivery,
      items: rawItems, // [{ key, qty }] — name/price з клієнта ігноруються
      promo
    } = body;

    if (!name || !phone || !Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Перерахунок кошика на сервері
    const items = [];
    for (const it of rawItems) {
      const p = PRICES[it && it.key];
      const qty = parseInt(it && it.qty, 10);
      if (!p || !Number.isInteger(qty) || qty < 1 || qty > 20) {
        res.status(400).json({ error: 'Invalid cart item' });
        return;
      }
      items.push({ key: it.key, name: p.name, qty: qty, price: p.price, set: !!p.set });
    }
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const promoCode = promo ? String(promo).trim().toUpperCase() : null;
    const promoPct = promoCode && PROMOS[promoCode] ? PROMOS[promoCode] : 0;
    const promoBase = items.filter(it => !it.set).reduce((s, it) => s + it.price * it.qty, 0);
    const discount = Math.round(promoBase * promoPct / 100);
    const total = subtotal - discount;

    // Split name into first/last for NovaPay's fields (best effort)
    const parts = String(name).trim().split(/\s+/);
    const firstName = parts[0] || name;
    const lastName = parts.slice(1).join(' ') || '.';

    // Unique order reference
    const orderId = 'LK' + Date.now();

    // Compact order summary — stored in metadata so the callback can log it
    const summary = items.map(function (it) {
      return it.name + ' x' + it.qty;
    }).join(', ') + (promoPct ? ' | Промокод ' + promoCode + ' -' + promoPct + '%' : '');

    // NovaPay expects a clean phone number, e.g. +380991234567 (no spaces)
    const cleanPhone = '+' + String(phone).replace(/\D/g, '');

    // 1) Create session
    const session = await novaPayRequest('/session', {
      merchant_id: merchantId,
      client_first_name: firstName,
      client_last_name: lastName,
      client_phone: cleanPhone,
      callback_url: siteUrl + '/api/novapay-callback',
      success_url: siteUrl + '/payment-success.html',
      fail_url: siteUrl + '/payment-fail.html',
      success_redirect_timeout: 5,
      metadata: {
        order_id: orderId,
        summary: summary,
        city: city || '',
        delivery: delivery || '',
        phone: phone,
        name: name,
        total: total
      }
    });

    const sessionId = session.id;

    // 2) Create payment against that session
    const payment = await novaPayRequest('/payment', {
      merchant_id: merchantId,
      session_id: sessionId,
      amount: total,
      external_id: orderId,
      use_hold: false,
      // Якщо є знижка — одна позиція на всю суму, щоб сума товарів = amount
      products: discount > 0
        ? [{ description: summary, count: 1, price: total }]
        : items.map(function (it) {
            return { description: it.name, count: it.qty, price: it.price };
          })
    });

    res.status(200).json({ url: payment.url, order_id: orderId, total: total });
  } catch (err) {
    console.error('novapay-checkout error:', err.message, err.body || '');
    res.status(500).json({ error: 'Payment session could not be created. Please try again or pay on delivery.' });
  }
};
