import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-web-push-secret',
};

type NotificationRow = {
  id: string;
  profile_id: string;
  kind: string;
  title: string | null;
  body: string | null;
  destination: string | null;
};

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function notificationFromPayload(payload: Record<string, unknown>, notificationId: string): NotificationRow | null {
  const profileId = String(payload?.profile_id || '').trim();
  const kind = String(payload?.kind || '').trim();
  if (!profileId || !kind) return null;
  return {
    id: notificationId,
    profile_id: profileId,
    kind,
    title: payload?.title == null ? null : String(payload.title),
    body: payload?.body == null ? null : String(payload.body),
    destination: payload?.destination == null ? null : String(payload.destination),
  };
}

async function loadNotification(
  admin: ReturnType<typeof createClient>,
  notificationId: string,
  payload: Record<string, unknown>,
): Promise<NotificationRow | null> {
  const fromPayload = notificationFromPayload(payload, notificationId);
  if (fromPayload) return fromPayload;

  // Retry briefly: pg_net can beat the inserting transaction's visibility.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(150 * attempt);
    const { data, error } = await admin
      .from('notifications')
      .select('id, profile_id, kind, title, body, destination')
      .eq('id', notificationId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as NotificationRow;
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const hookSecret = requireEnv('WEB_PUSH_HOOK_SECRET');
    const provided = request.headers.get('x-web-push-secret') || '';
    if (provided !== hookSecret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    const notificationId = String(payload?.notification_id || '').trim();
    if (!notificationId) {
      return jsonResponse({ error: 'notification_id required' }, 400);
    }

    const supabaseUrl = requireEnv('SUPABASE_URL');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const vapidPublic = requireEnv('VAPID_PUBLIC_KEY');
    const vapidPrivate = requireEnv('VAPID_PRIVATE_KEY');
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:itc@islandecc.hk';

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const notification = await loadNotification(admin, notificationId, payload);
    if (!notification) return jsonResponse({ ok: true, skipped: 'missing_notification' });

    const { data: application, error: appError } = await admin
      .from('applications')
      .select('web_push_ops')
      .eq('profile_id', notification.profile_id)
      .maybeSingle();
    if (appError) throw appError;
    if (!application?.web_push_ops) {
      return jsonResponse({ ok: true, skipped: 'opted_out' });
    }

    const { data: subscriptions, error: subError } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('profile_id', notification.profile_id);
    if (subError) throw subError;
    if (!subscriptions?.length) {
      return jsonResponse({ ok: true, skipped: 'no_subscriptions' });
    }

    const destination = String(notification.destination || '#/notifications').trim();
    const openUrl = destination.startsWith('#')
      ? `/app/${destination}`
      : destination.startsWith('/app/')
      ? destination
      : `/app/#/notifications`;

    const body = {
      title: notification.title || 'Island Training Club',
      body: notification.body || '',
      url: openUrl,
    };

    let sent = 0;
    const removed: string[] = [];
    for (const row of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          JSON.stringify(body),
        );
        sent += 1;
      } catch (err) {
        const statusCode = Number((err as { statusCode?: number })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', row.id);
          removed.push(row.id);
        }
      }
    }

    return jsonResponse({ ok: true, sent, removed: removed.length, kind: notification.kind });
  } catch (err) {
    console.error('send-web-push failed', err);
    return jsonResponse({ error: 'Unable to send web push' }, 500);
  }
});
