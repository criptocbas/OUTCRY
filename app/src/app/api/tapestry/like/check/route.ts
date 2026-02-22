import { NextRequest, NextResponse } from "next/server";

const TAPESTRY_BASE = "https://api.usetapestry.dev/api/v1";
const API_KEY = process.env.TAPESTRY_API_KEY;

export async function GET(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Tapestry not configured" },
      { status: 503 }
    );
  }

  const profileId = req.nextUrl.searchParams.get("profileId");
  const contentId = req.nextUrl.searchParams.get("contentId");

  if (!profileId || !contentId) {
    return NextResponse.json(
      { error: "profileId and contentId are required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `${TAPESTRY_BASE}/likes/check?profileId=${encodeURIComponent(profileId)}&contentId=${encodeURIComponent(contentId)}&apiKey=${API_KEY}`
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry like check error:", error);
    return NextResponse.json(
      { error: "Failed to check like status" },
      { status: 500 }
    );
  }
}
