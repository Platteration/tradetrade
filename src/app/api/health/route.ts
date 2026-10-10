export const dynamic = "force-dynamic";

// This endpoint reports HTTP process liveness only. Add real dependency queries
// to a separate readiness check if the product later adds a database or service.
export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
