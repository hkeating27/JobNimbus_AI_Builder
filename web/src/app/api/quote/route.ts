import { NextResponse } from "next/server";
import { measureRoof } from "@/lib/measure";
import { generateQuote } from "@/lib/quote";
import type { RoofMeasurement } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { address?: string; measurement?: RoofMeasurement };
    let m: RoofMeasurement;
    if (body.measurement) {
      m = body.measurement;
    } else if (body.address) {
      m = await measureRoof(body.address.trim());
    } else {
      return NextResponse.json({ error: "address or measurement required" }, { status: 400 });
    }
    const q = generateQuote(m);
    return NextResponse.json(q);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "quote failed" }, { status: 500 });
  }
}
