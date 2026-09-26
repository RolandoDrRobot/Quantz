import { NextResponse } from "next/server";

// The build id of whatever deploy is live right now. UpdateWatcher compares it
// against the id baked into the client bundle it's running — a mismatch means
// a newer deploy is out and the page should reload.
export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
