import { runNodeHandler } from "../../_server/express-bridge";

// The Express API (apps/api) served through Next so everything deploys to Vercel as one project.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  const { getServerlessApp } = await import("@media/api/dist/serverless.js");
  return runNodeHandler(getServerlessApp(), request);
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
  handle as HEAD,
};
