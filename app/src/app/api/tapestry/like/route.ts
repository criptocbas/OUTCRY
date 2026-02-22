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
    const { profileId, contentId } = body;

    if (!profileId || !contentId) {
      return NextResponse.json(
        { error: "profileId and contentId are required" },
        { status: 400 }
      );
    }

    // Tapestry: POST /likes/{nodeId} with { startId } in body
    const res = await fetch(
      `${TAPESTRY_BASE}/likes/${encodeURIComponent(contentId)}?apiKey=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startId: profileId }),
      }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry like error:", error);
    return NextResponse.json(
      { error: "Failed to like content" },
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
    const { profileId, contentId } = body;

    if (!profileId || !contentId) {
      return NextResponse.json(
        { error: "profileId and contentId are required" },
        { status: 400 }
      );
    }

    // Tapestry: DELETE /likes/{nodeId} with { startId } in body
    const res = await fetch(
      `${TAPESTRY_BASE}/likes/${encodeURIComponent(contentId)}?apiKey=${API_KEY}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startId: profileId }),
      }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry unlike error:", error);
    return NextResponse.json(
      { error: "Failed to unlike content" },
      { status: 500 }
    );
  }
}
