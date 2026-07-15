import { NextRequest, NextResponse } from "next/server";
import { authenticate, getOrg, saveOrg, PortalRequest } from "@/lib/store";

async function auth(req: NextRequest) {
  const id = req.headers.get("x-id") || "";
  const pin = req.headers.get("x-pin") || "";
  return { id: id.trim().toUpperCase(), ...(await authenticate(id, pin)) };
}

export async function GET(req: NextRequest) {
  const a = await auth(req);
  if (!a.role) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const org = await getOrg();
  const from = req.nextUrl.searchParams.get("from") || "0000-00-00";
  const to = req.nextUrl.searchParams.get("to") || "9999-99-99";
  let list = org.requests.filter((r) => r.date >= from && r.date <= to);
  if (a.role === "staff") list = list.filter((r) => r.id === a.id);
  return NextResponse.json({ ok: true, requests: list });
}

export async function POST(req: NextRequest) {
  const a = await auth(req);
  if (!a.role) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const body = await req.json();
  const target = a.role === "admin" ? String(body.id || "").toUpperCase() : a.id;
  if (!target) return NextResponse.json({ ok: false, error: "Missing staff id." }, { status: 400 });
  const r: PortalRequest = {
    key: `${target}-${body.date}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    id: target,
    date: String(body.date),
    kind: body.kind === "day" || body.kind === "night" || body.kind === "custom" ? body.kind : "all",
    from: String(body.from || "08:00"),
    to: String(body.to || "12:00"),
    submittedAt: new Date().toISOString(),
  };
  const org = await getOrg();
  org.requests.push(r);
  await saveOrg(org);
  return NextResponse.json({ ok: true, request: r });
}

export async function DELETE(req: NextRequest) {
  const a = await auth(req);
  if (!a.role) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const key = req.nextUrl.searchParams.get("key") || "";
  const org = await getOrg();
  const r = org.requests.find((x) => x.key === key);
  if (!r) return NextResponse.json({ ok: false, error: "Request not found." }, { status: 404 });
  if (a.role === "staff" && r.id !== a.id) {
    return NextResponse.json({ ok: false, error: "You can only remove your own requests." }, { status: 403 });
  }
  org.requests = org.requests.filter((x) => x.key !== key);
  await saveOrg(org);
  return NextResponse.json({ ok: true });
}
