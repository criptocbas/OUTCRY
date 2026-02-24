import { NextRequest, NextResponse } from "next/server";

const TAPESTRY_BASE = "https://api.usetapestry.dev/api/v1";
const API_KEY = process.env.TAPESTRY_API_KEY;

export async function GET(req: NextRequest) {
  const profileId = req.nextUrl.searchParams.get("profileId");
  const contentId = req.nextUrl.searchParams.get("contentId");

  if (!profileId || !contentId) {
    return NextResponse.json(
      { error: "profileId and contentId are required" },
      { status: 400 }
    );
  }

  if (!API_KEY) {
    return NextResponse.json({ hasLiked: false });
  }

  try {
    const res = await fetch(
      `${TAPESTRY_BASE}/contents/${encodeURIComponent(contentId)}?apiKey=${API_KEY}&requestingProfileId=${encodeURIComponent(profileId)}`
    );

    if (!res.ok) {
      // Content node doesn't exist yet
      return NextResponse.json({ hasLiked: false });
    }

    const data = await res.json();
    const hasLiked = data.requestingProfileSocialInfo?.hasLiked ?? false;

    return NextResponse.json({ hasLiked });
  } catch {
    return NextResponse.json({ hasLiked: false });
  }
}
