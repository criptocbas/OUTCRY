import { NextResponse } from "next/server";

// Tapestry does not have a dedicated like count endpoint.
// Return 0 — the UI tracks count optimistically after toggle.
export async function GET() {
  return NextResponse.json({ count: 0 });
}
