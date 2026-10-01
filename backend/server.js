require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { RouterOSAPI } = require('node-routeros');

const app = express();

// ─── Plan Configuration ─────────────────────────────────────────
// Paystack amounts are in KOBO (₦1 = 100 kobo)
const PLANS = {
  DailySub: {
    amount: 100000, // ₦1,000.00
    label: 'Daily (20h)',
    profile: 'DailySub',
  },
  WeeklySub: {
    amount: 500000, // ₦5,000.00
    label: 'Weekly (7d)',
    profile: 'WeeklySub',
  },
  MonthlySub: {
    amount: 2000000, // ₦20,000.00 (2 devices)
    label: 'Monthly (30d)',
    profile: 'MonthlySub',
  },
};

const {
  PAYSTACK_SECRET_KEY,
  PAYSTACK_PUBLIC_KEY,
  MIKROTIK_HOST = '10.10.10.2',
  MIKROTIK_USER = 'admin',
  MIKROTIK_PASSWORD = '',
  MIKROTIK_PORT = 8728,
  PORT = 3000,
} = process.env;

// ─── In-memory Transaction Store ────────────────────────────────
// reference -> { plan, voucher, status, createdAt }
const transactions = new Map();

// Auto-purge transactions older than 24 hours
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [ref, tx] of transactions) {
    if (tx.createdAt < cutoff) {
      transactions.delete(ref);
    }
  }
}, 60 * 60 * 1000);

// ─── Middleware ─────────────────────────────────────────────────
// Preserve raw body for Paystack webhook HMAC verification
app.use(
  '/api/webhook',
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.json());
app.use(cors());

// ─── Helpers ────────────────────────────────────────────────────
function generateVoucher() {
  // Excludes ambiguous characters (0, O, 1, I, L)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
    if (i === 3) code += '-';
  }
  return code;
}

async function createMikroTikUser(username, password, profile) {
  const client = new RouterOSAPI({
    host: MIKROTIK_HOST,
    user: MIKROTIK_USER,
    password: MIKROTIK_PASSWORD,
    port: Number(MIKROTIK_PORT),
  });

  try {
    await client.connect();
    await client.write('/ip/hotspot/user/add', [
      `=name=${username}`,
      `=password=${password}`,
      `=profile=${profile}`,
      `=comment=Paystack: ${profile}`,
    ]);
    console.log(`[MikroTik] Successfully created hotspot user: ${username} (profile: ${profile})`);
  } catch (err) {
    console.error(`[MikroTik Error] Failed to create user ${username}:`, err.message || err);
    throw err;
  } finally {
    try {
      await client.close();
    } catch (_) {}
  }
}

async function verifyWithPaystack(reference) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });
  return await res.json();
}

// ─── Routes ─────────────────────────────────────────────────────

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mikrotikHost: MIKROTIK_HOST,
    activeTransactions: transactions.size,
  });
});

// 1. Initialize Payment (called from captive portal)
app.post('/api/initialize', async (req, res) => {
  const { plan, email: clientEmail } = req.body;
  if (!plan || !PLANS[plan]) {
    return res.status(400).json({ error: 'Invalid or missing plan' });
  }

  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ error: 'Paystack secret key is not configured' });
  }

  const { amount } = PLANS[plan];
  const reference = `HOTSPOT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  // If a valid email is passed, Paystack will send the payment receipt to it.
  // Otherwise, fallback to a dead address like guest@example.com.
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const trimmedEmail = typeof clientEmail === 'string' ? clientEmail.trim() : '';
  const email = (trimmedEmail && emailRegex.test(trimmedEmail))
    ? trimmedEmail
    : 'guest@example.com';

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount,
        email,
        reference,
        currency: 'NGN',
        metadata: {
          plan,
          source: 'captive_portal',
        },
      }),
    });

    const data = await response.json();

    if (!data.status || !data.data?.access_code) {
      console.error('[Initialize Error] Paystack response:', data);
      return res.status(500).json({ error: data.message || 'Failed to initialize payment with Paystack' });
    }

    transactions.set(reference, {
      plan,
      voucher: null,
      status: 'pending',
      createdAt: Date.now(),
    });

    return res.json({
      reference,
      access_code: data.data.access_code,
      public_key: PAYSTACK_PUBLIC_KEY,
    });
  } catch (err) {
    console.error('[Initialize Exception]', err);
    return res.status(500).json({ error: 'Internal server error during payment initialization' });
  }
});

// 2. Verify Payment & Generate Voucher
// SECURITY: Voucher is only created and returned if Paystack confirms status === 'success'
// and the paid amount matches the configured plan amount.
app.get('/api/verify/:reference', async (req, res) => {
  const { reference } = req.params;
  const tx = transactions.get(reference);

  // If already verified and completed, return existing voucher (idempotent)
  if (tx && tx.status === 'completed' && tx.voucher) {
    return res.json({
      voucher_code: tx.voucher,
      plan: tx.plan,
      status: 'success',
    });
  }

  try {
    const data = await verifyWithPaystack(reference);

    if (!data.status || data.data?.status !== 'success') {
      console.warn(`[Verify REJECTED] ${reference}: Paystack status = ${data.data?.status || 'failed'}`);
      return res.status(402).json({
        error: 'Payment not confirmed',
        detail: 'Your payment has not been confirmed by Paystack. No voucher will be issued.',
        paystack_status: data.data?.status || 'unknown',
      });
    }

    // Identify plan
    const paidAmount = data.data.amount;
    const plan = tx?.plan || Object.keys(PLANS).find((k) => PLANS[k].amount === paidAmount);

    if (!plan) {
      console.warn(`[Verify REJECTED] ${reference}: No plan matches paid amount ${paidAmount}`);
      return res.status(400).json({ error: 'Unknown plan for the paid amount' });
    }

    // Verify amount match
    if (paidAmount !== PLANS[plan].amount) {
      console.warn(`[Verify REJECTED] ${reference}: Amount mismatch. Expected ${PLANS[plan].amount}, got ${paidAmount}`);
      return res.status(400).json({
        error: 'Payment amount mismatch',
        detail: 'The paid amount does not match the selected plan. No voucher will be issued.',
      });
    }

    // Generate unique voucher code
    const voucher = generateVoucher();

    // Create user in MikroTik hotspot via RouterOS API
    await createMikroTikUser(voucher, voucher, PLANS[plan].profile);

    // Save transaction completion
    transactions.set(reference, {
      plan,
      voucher,
      status: 'completed',
      createdAt: tx?.createdAt || Date.now(),
    });

    console.log(`[Verify OK] ${reference}: Voucher ${voucher} issued for profile ${PLANS[plan].profile}`);
    return res.json({
      voucher_code: voucher,
      plan,
      status: 'success',
    });
  } catch (err) {
    console.error(`[Verify Exception] ${reference}:`, err);
    return res.status(500).json({
      error: 'Verification failed',
      detail: 'An error occurred during verification or user creation.',
    });
  }
});

// 3. Webhook Backup Route (Paystack server-to-server)
app.post('/api/webhook', (req, res) => {
  if (!PAYSTACK_SECRET_KEY) {
    return res.sendStatus(500);
  }

  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET_KEY)
    .update(req.rawBody || '')
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    console.warn('[Webhook Warning] Signature mismatch');
    return res.sendStatus(401);
  }

  // Acknowledge receipt immediately to Paystack
  res.sendStatus(200);

  const event = req.body;
  if (event.event === 'charge.success') {
    const { reference, amount } = event.data;
    const tx = transactions.get(reference);

    // Only process if user hasn't already received their voucher via the verify route
    if (!tx || tx.status !== 'completed') {
      const plan = tx?.plan || Object.keys(PLANS).find((k) => PLANS[k].amount === amount);
      if (plan) {
        const voucher = generateVoucher();
        createMikroTikUser(voucher, voucher, PLANS[plan].profile)
          .then(() => {
            transactions.set(reference, {
              plan,
              voucher,
              status: 'completed',
              createdAt: tx?.createdAt || Date.now(),
            });
            console.log(`[Webhook OK] Created user for ${reference}: ${voucher}`);
          })
          .catch((err) => {
            console.error(`[Webhook Error] Failed to create user for ${reference}:`, err.message || err);
          });
      }
    }
  }
});

// ─── Start Server ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] Hotspot payment backend running on port ${PORT}`);
  console.log(`[Config] MikroTik Target: ${MIKROTIK_HOST}:${MIKROTIK_PORT}`);
  console.log(`[Config] Plans configured: ${Object.keys(PLANS).join(', ')}`);
});
