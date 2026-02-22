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
    const { profileId, content, customProperties } = body;

    if (!profileId || !content) {
      return NextResponse.json(
        { error: "profileId and content are required" },
        { status: 400 }
      );
    }

    // Build properties array from content text + custom properties
    const properties: { key: string; value: string }[] = [
      { key: "content", value: content },
      { key: "contentType", value: "text" },
    ];
    if (customProperties) {
      for (const [key, value] of Object.entries(customProperties)) {
        properties.push({ key, value: String(value) });
      }
    }

    // Tapestry uses POST /contents/findOrCreate
    const contentId = `outcry-${profileId}-${Date.now()}`;
    const res = await fetch(
      `${TAPESTRY_BASE}/contents/findOrCreate?apiKey=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: contentId,
          profileId,
          properties,
        }),
      }
    );

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("Tapestry content response not JSON:", text.slice(0, 200));
      return NextResponse.json(
        { error: "Invalid response from Tapestry" },
        { status: 502 }
      );
    }

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry content create error:", error);
    return NextResponse.json(
      { error: "Failed to create content" },
      { status: 500 }
    );
  }
}
