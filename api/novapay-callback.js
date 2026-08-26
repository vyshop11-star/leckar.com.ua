// api/novapay-callback.js
// NovaPay calls this server-to-server after a payment session changes status
// (e.g. successful card payment). We forward a Telegram notification and also
// log the order into the same Google Sheet used for cash-on-delivery orders,
// by reusing the existing Apps Script endpoint.

module.exports = async (req, res) => {
  try {
    const data = req.body || {};

    // NovaPay's callback payload shape follows the "Get status" response format
    // (see documentation): { id, metadata, status, client_first_name, amount, ... }
    const meta = data.metadata || {};
    const status = data.status || data.transaction_status || 'unknown';
    const isSuccess = ['approved', 'holded', 'completed'].includes(String(status).toLowerCase())
      || data.transaction_status === 'APPROVED';

    const telegramToken = process.env.TELEGRAM_TOKEN;
    const telegramChat = process.env.TELEGRAM_CHAT_ID;
    const appsScriptUrl = process.env.APPS_SCRIPT_URL;

    const orderId = meta.order_id || data.external_id || '—';
    const summary = meta.summary || '—';
    const total = meta.total || data.amount || '—';
    const name = meta.name || (data.client_first_name || '') + ' ' + (data.client_last_name || '');
    const phone = meta.phone || data.client_phone || '—';
    const city = meta.city || '—';
    const delivery = meta.delivery || '—';

    const emoji = isSuccess ? '✅' : '⚠️';
    const statusLabel = isSuccess ? 'ОПЛАЧЕНО КАРТКОЮ' : 'СТАТУС: ' + status;

    const tgMessage =
      emoji + ' *' + statusLabel + '*\n' +
      '━━━━━━━━━━━━━━━━━\n' +
      '🧾 *Замовлення:* ' + orderId + '\n' +
      '👤 *Ім\'я:* ' + name + '\n' +
      '📞 *Телефон:* ' + phone + '\n' +
      '📍 *Місто:* ' + city + '\n' +
      '🚚 *Доставка:* ' + delivery + '\n' +
      '📦 *Товар:* ' + summary + '\n' +
      '💰 *Сума:* ' + total + ' \u20B4\n' +
      '━━━━━━━━━━━━━━━━━\n' +
      '⏰ ' + new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' });

    if (telegramToken && telegramChat) {
      await fetch('https://api.telegram.org/bot' + telegramToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramChat, text: tgMessage, parse_mode: 'Markdown' })
      });
    }

    // Also log into the same Google Sheet as cash orders, if configured
    if (appsScriptUrl && isSuccess) {
      try {
        await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            phone: "'" + phone,
            city: city,
            delivery: delivery,
            product: summary + ' | Разом: ' + total + ' \u20B4 | Оплачено карткою (NovaPay, ' + orderId + ')'
          })
        });
      } catch (e) {
        console.error('Apps Script logging failed:', e.message);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('novapay-callback error:', err.message);
    // Always 200 back to NovaPay so it doesn't endlessly retry a broken callback
    res.status(200).json({ ok: false });
  }
};
