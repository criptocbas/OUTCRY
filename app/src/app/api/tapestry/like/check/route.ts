import { NextRequest, NextResponse } from "next/server";

// Tapestry does not have a dedicated like check endpoint.
// Return a default response so the UI works without errors.
export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  const contentId = req.nextUrl.searchParams.get("contentId");

  if (!profileId || !contentId) {
    return NextResponse.json(
      { error: "profileId and contentId are required" },
      { status: 400 }
    );
  }

  // Default to not liked — the UI tracks optimistic state after toggle
  return NextResponse.json({ hasLiked: false });
}
