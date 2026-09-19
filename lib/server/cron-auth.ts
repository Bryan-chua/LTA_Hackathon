import { timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

const oidcClient = new OAuth2Client();

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
};

const matchesSecret = (token: string, secret: string) => {
  const supplied = Buffer.from(token);
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

export async function isCronRequestAuthorized(request: Request): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && matchesSecret(token, cronSecret)) return true;

  const expectedEmail = process.env.GCP_SCHEDULER_SERVICE_ACCOUNT?.trim();
  if (!expectedEmail) return false;

  const configuredBase = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  const endpoint = new URL("/api/cron/morning-checks", configuredBase || request.url).toString();
  const audiences = configuredBase ? [configuredBase, endpoint] : [endpoint];

  try {
    const ticket = await oidcClient.verifyIdToken({ idToken: token, audience: audiences });
    const payload = ticket.getPayload();
    return payload?.email === expectedEmail && payload.email_verified !== false;
  } catch {
    return false;
  }
}
