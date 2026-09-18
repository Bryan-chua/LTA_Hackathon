import { noStore } from "@/lib/application/demand-http";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.PUSH_ENABLED !== "true" || !process.env.VAPID_PUBLIC_KEY) {
    return Response.json({ error: { code: "PUSH_DISABLED", message: "Commute alerts are not enabled on this deployment." } }, { status: 404, headers: noStore });
  }
  return Response.json({ data: { publicKey: process.env.VAPID_PUBLIC_KEY } }, { headers: noStore });
}
