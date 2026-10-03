import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import nodemailer from 'npm:nodemailer@6.9.16';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-email-receipt-secret',
};

const RECEIPT_FROM = 'Island Training Club <itc.admin.ops@gmail.com>';
const GMAIL_USER = 'itc.admin.ops@gmail.com';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function methodLabel(value: string | null | undefined): string {
  const method = String(value || '').toLowerCase();
  if (method === 'fps') return 'FPS';
  if (method === 'payme') return 'PayMe';
  return method || 'payment';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const hookSecret = requireEnv('EMAIL_RECEIPT_HOOK_SECRET');
    const provided = request.headers.get('x-email-receipt-secret') || '';
    if (provided !== hookSecret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    const receiptId = String(payload?.receipt_id || '').trim();
    const profileId = String(payload?.profile_id || '').trim();
    if (!receiptId || !profileId) {
      return jsonResponse({ error: 'receipt_id and profile_id required' }, 400);
    }

    const supabaseUrl = requireEnv('SUPABASE_URL');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const smtpPass = requireEnv('GMAIL_SMTP_APP_PASSWORD');

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: application, error: appError } = await admin
      .from('applications')
      .select('email_receipts')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (appError) throw appError;
    if (!application?.email_receipts) {
      return jsonResponse({ ok: true, skipped: 'opted_out' });
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('email, full_name')
      .eq('id', profileId)
      .maybeSingle();
    if (profileError) throw profileError;
    const to = String(profile?.email || '').trim();
    if (!to.includes('@')) {
      return jsonResponse({ ok: true, skipped: 'missing_email' });
    }

    let receiptNumber = String(payload?.receipt_number || '').trim();
    let amountHkd = Number(payload?.amount_hkd);
    let currency = String(payload?.currency || 'HKD');
    let paymentMethod = String(payload?.payment_method || '');
    let sessionId = String(payload?.session_id || '');
    if (!receiptNumber) {
      const { data: receipt, error: receiptError } = await admin
        .from('operational_receipts')
        .select('receipt_number, amount_hkd, currency, payment_method, session_id')
        .eq('id', receiptId)
        .maybeSingle();
      if (receiptError) throw receiptError;
      if (!receipt) return jsonResponse({ ok: true, skipped: 'missing_receipt' });
      receiptNumber = String(receipt.receipt_number || '');
      amountHkd = Number(receipt.amount_hkd);
      currency = String(receipt.currency || 'HKD');
      paymentMethod = String(receipt.payment_method || '');
      sessionId = String(receipt.session_id || '');
    }

    let sessionLine = sessionId || 'ITC session';
    if (sessionId) {
      const { data: session } = await admin
        .from('operational_sessions')
        .select('activity_id, session_date, start_time, venue')
        .eq('id', sessionId)
        .maybeSingle();
      if (session) {
        sessionLine = `${session.activity_id} on ${session.session_date} ${session.start_time} · ${session.venue}`;
      }
    }

    const amount = Number.isFinite(amountHkd) ? amountHkd : 0;
    const greeting = profile?.full_name ? `Hi ${profile.full_name},` : 'Hi,';
    const subject = `ITC receipt ${receiptNumber}`;
    const text = [
      greeting,
      '',
      `Payment confirmed. Receipt ${receiptNumber} for ${currency} ${amount} via ${methodLabel(paymentMethod)}.`,
      sessionLine,
      '',
      'This receipt was sent from Island Training Club (itc.admin.ops@gmail.com) because Email receipts is on in Notifications.',
      'You can turn this off any time in Profile → Notifications.',
    ].join('\n');

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: GMAIL_USER,
        pass: smtpPass,
      },
    });

    await transporter.sendMail({
      from: RECEIPT_FROM,
      to,
      subject,
      text,
    });

    return jsonResponse({
      ok: true,
      sent: true,
      receipt_id: receiptId,
      to,
    });
  } catch (err) {
    console.error('send-email-receipt failed', err);
    return jsonResponse({ error: 'Unable to send email receipt' }, 500);
  }
});
