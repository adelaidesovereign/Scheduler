import { NextRequest, NextResponse } from "next/server";
import { authenticate, kvConfigured } from "@/lib/store";

export async function POST(req: NextRequest) {
  const { id, pin } = await req.json();
  const auth = await authenticate(id, pin);
  if (!auth.role) {
    return NextResponse.json({ ok: false, error: "Initials or PIN did not match." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, role: auth.role, name: auth.name, persistent: kvConfigured() });
}
