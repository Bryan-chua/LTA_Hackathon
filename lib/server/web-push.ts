import webpush from "web-push";

let configured = false;

function configure() {
  if (configured) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) throw new Error("VAPID configuration is incomplete.");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendWebPush(target: PushTarget, payload: object, ttlSeconds = 900) {
  configure();
  return webpush.sendNotification({
    endpoint: target.endpoint,
    keys: { p256dh: target.p256dh, auth: target.auth },
  }, JSON.stringify(payload), { TTL: ttlSeconds });
}
