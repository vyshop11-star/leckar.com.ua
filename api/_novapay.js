// api/_novapay.js
// Shared helper: RSA-SHA256 signing + NovaPay API calls.
// Private key is read from Vercel Environment Variable NOVAPAY_PRIVATE_KEY_B64
// (base64-encoded full .pem content). NEVER commit the key itself to git.

const crypto = require('crypto');

const API_BASE = 'https://api-ecom.novapay.ua/v1';

function getPrivateKeyPem() {
  const b64 = process.env.NOVAPAY_PRIVATE_KEY_B64;
  if (!b64) throw new Error('NOVAPAY_PRIVATE_KEY_B64 env var is not set');
  return Buffer.from(b64, 'base64').toString('utf8');
}

// IMPORTANT: sign the EXACT same string that will be sent as the request body.
// Do not re-serialize the object after signing — whitespace differences break the signature.
function signBody(bodyString) {
  const pem = getPrivateKeyPem();
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(bodyString, 'utf8');
  signer.end();
  return signer.sign(pem, 'base64');
}

async function novaPayRequest(path, bodyObj) {
  const bodyString = JSON.stringify(bodyObj);
  const xSign = signBody(bodyString);

  const resp = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sign': xSign
    },
    body: bodyString
  });

  const text = await resp.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }

  if (!resp.ok) {
    const err = new Error('NovaPay API error: ' + resp.status + ' ' + text);
    err.status = resp.status;
    err.body = json;
    throw err;
  }
  return json;
}

module.exports = { novaPayRequest, signBody, getPrivateKeyPem, API_BASE };
