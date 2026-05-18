import { NextResponse } from "next/server";
import { measureRoof } from "@/lib/measure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { address } = (await req.json()) as { address?: string };
    if (!address || address.trim().length < 5) {
      return NextResponse.json({ error: "address required" }, { status: 400 });
    }
    const m = await measureRoof(address.trim());
    return NextResponse.json(m);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "measure failed" }, { status: 500 });
  }
}
