import { NextRequest, NextResponse } from "next/server";

const TAPESTRY_BASE = "https://api.usetapestry.dev/api/v1";
const API_KEY = process.env.TAPESTRY_API_KEY;

export async function POST(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Tapestry not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { startId, endId } = body;

    if (!startId || !endId) {
      return NextResponse.json(
        { error: "startId and endId are required" },
        { status: 400 }
      );
    }

    const res = await fetch(`${TAPESTRY_BASE}/followers/add?apiKey=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startId, endId }),
    });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry follow error:", error);
    return NextResponse.json(
      { error: "Failed to follow user" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!API_KEY) {
    return NextResponse.json(
      { error: "Tapestry not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { startId, endId } = body;

    if (!startId || !endId) {
      return NextResponse.json(
        { error: "startId and endId are required" },
        { status: 400 }
      );
    }

    // Tapestry uses POST /followers/remove (not DELETE)
    const res = await fetch(`${TAPESTRY_BASE}/followers/remove?apiKey=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startId, endId }),
    });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry unfollow error:", error);
    return NextResponse.json(
      { error: "Failed to unfollow user" },
      { status: 500 }
    );
  }
}
