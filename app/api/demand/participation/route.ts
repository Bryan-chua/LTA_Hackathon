import { handleDemandRequest } from "@/lib/application/demand-http";

export const runtime = "nodejs";
export const GET = handleDemandRequest;
export const POST = handleDemandRequest;
export const DELETE = handleDemandRequest;
