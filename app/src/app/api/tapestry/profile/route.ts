import { NextRequest, NextResponse } from "next/server";

const TAPESTRY_BASE = "https://api.usetapestry.dev/v1";
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
    const { walletAddress, username } = body;

    if (!walletAddress || !username) {
      return NextResponse.json(
        { error: "walletAddress and username are required" },
        { status: 400 }
      );
    }

    const res = await fetch(
      `${TAPESTRY_BASE}/profiles/findOrCreate?apiKey=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          username,
          blockchain: "SOLANA",
          execution: "FAST_UNCONFIRMED",
        }),
      }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Tapestry profile create error:", error);
    return NextResponse.json(
      { error: "Failed to find or create profile" },
      { status: 500 }
    );
  }
}
