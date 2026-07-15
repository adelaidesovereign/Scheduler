import { NextRequest, NextResponse } from "next/server";
import { authenticate, getOrg, saveOrg, kvConfigured } from "@/lib/store";

async function auth(req: NextRequest) {
  const id = req.headers.get("x-id") || "";
  const pin = req.headers.get("x-pin") || "";
  return await authenticate(id, pin);
}

export async function GET(req: NextRequest) {
  const a = await auth(req);
  if (a.role !== "admin") return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  const org = await getOrg();
  return NextResponse.json({ ok: true, staff: org.staff, adminId: org.adminId, adminName: org.adminName, persistent: kvConfigured() });
}

// Admin publishes the staff list and PINs so the portal accepts their logins.
export async function PUT(req: NextRequest) {
  const a = await auth(req);
  if (a.role !== "admin") return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  const body = await req.json();
  const org = await getOrg();
  if (Array.isArray(body.staff)) {
    org.staff = body.staff
      .filter((s: { id?: string }) => s.id)
      .map((s: { id: string; name?: string; pin?: string }) => ({
        id: String(s.id).toUpperCase(),
        name: String(s.name || ""),
        pin: String(s.pin || "1111"),
      }));
  }
  if (body.adminPin) org.adminPin = String(body.adminPin);
  await saveOrg(org);
  return NextResponse.json({ ok: true, persistent: kvConfigured() });
}
