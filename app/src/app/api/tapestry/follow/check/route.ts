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

  const followerId = req.nextUrl.searchParams.get("followerId");
  const followeeId = req.nextUrl.searchParams.get("followeeId");

  if (!followerId || !followeeId) {
    return NextResponse.json(
      { error: "followerId and followeeId are required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `${TAPESTRY_BASE}/followers/state?apiKey=${API_KEY}&startId=${encodeURIComponent(followerId)}&endId=${encodeURIComponent(followeeId)}`
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    // Normalize response to match our FollowStatus interface
    return NextResponse.json({
      isFollowing: data.isFollowing ?? false,
    });
  } catch (error) {
    console.error("Tapestry follow check error:", error);
    return NextResponse.json(
      { error: "Failed to check follow status" },
      { status: 500 }
    );
  }
}
