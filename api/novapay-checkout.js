// api/novapay-checkout.js
// Called from the frontend checkout modal when the customer chooses "Оплатити карткою".
// Creates a NovaPay session, then a payment, and returns the redirect URL.

const { novaPayRequest } = require('./_novapay');

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
      items,      // [{ name, qty, price }]
      total       // number, UAH
    } = body;

    if (!name || !phone || !Array.isArray(items) || items.length === 0 || !total) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Split name into first/last for NovaPay's fields (best effort)
    const parts = String(name).trim().split(/\s+/);
    const firstName = parts[0] || name;
    const lastName = parts.slice(1).join(' ') || '.';

    // Unique order reference
    const orderId = 'LK' + Date.now();

    // Compact order summary — stored in metadata so the callback can log it
    const summary = items.map(function (it) {
      return it.name + ' x' + it.qty;
    }).join(', ');

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
      products: items.map(function (it) {
        return { description: it.name, count: it.qty, price: it.price };
      })
    });

    res.status(200).json({ url: payment.url, order_id: orderId });
  } catch (err) {
    console.error('novapay-checkout error:', err.message, err.body || '');
    res.status(500).json({ error: 'Payment session could not be created. Please try again or pay on delivery.' });
  }
};
