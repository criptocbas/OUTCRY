import { NextRequest, NextResponse } from "next/server";

const TAPESTRY_BASE = "https://api.usetapestry.dev/api/v1";
const API_KEY = process.env.TAPESTRY_API_KEY;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!API_KEY) {
    return NextResponse.json({ count: 0 });
  }

  const { id } = await params;

  try {
    const res = await fetch(
      `${TAPESTRY_BASE}/contents/${encodeURIComponent(id)}?apiKey=${API_KEY}`
    );

    if (!res.ok) {
      // Content node doesn't exist yet — no likes
      return NextResponse.json({ count: 0 });
    }

    const data = await res.json();
    const count = data.socialCounts?.likeCount ?? 0;

    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
