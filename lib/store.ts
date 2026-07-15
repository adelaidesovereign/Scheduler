// Shared storage for the staff portal.
// On Vercel with a KV database connected, data persists for everyone.
// Without KV (local dev), an in-memory store keeps the same behavior for testing.

import { kv } from "@vercel/kv";

export interface PortalStaff {
  id: string;
  name: string;
  pin: string;
}

export interface PortalRequest {
  key: string;          // unique id
  id: string;           // staff initials
  date: string;         // YYYY-MM-DD
  kind: "all" | "day" | "night" | "custom";
  from: string;
  to: string;
  submittedAt: string;
}

export interface OrgDoc {
  staff: PortalStaff[];
  adminId: string;
  adminName: string;
  adminPin: string;
  requests: PortalRequest[];
}

const DEFAULT_ORG: OrgDoc = {
  staff: [
    { id: "AT", name: "", pin: "1111" },
    { id: "CT", name: "", pin: "1111" },
    { id: "CM", name: "", pin: "1111" },
    { id: "AD", name: "", pin: "1111" },
    { id: "KH", name: "", pin: "1111" },
    { id: "WR", name: "", pin: "1111" },
    { id: "EH", name: "", pin: "1111" },
    { id: "SL", name: "", pin: "1111" },
    { id: "VT", name: "", pin: "1111" },
    { id: "YN", name: "", pin: "1111" },
  ],
  adminId: "SM",
  adminName: "Sandy Murphy",
  adminPin: "0000",
  requests: [],
};

const KEY = "org:v1";

export const kvConfigured = () =>
  Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// In-memory fallback shared across route calls in one server process.
const g = globalThis as unknown as { __orgMem?: OrgDoc };

export async function getOrg(): Promise<OrgDoc> {
  if (kvConfigured()) {
    const doc = await kv.get<OrgDoc>(KEY);
    if (doc) return doc;
    await kv.set(KEY, DEFAULT_ORG);
    return structuredClone(DEFAULT_ORG);
  }
  if (!g.__orgMem) g.__orgMem = structuredClone(DEFAULT_ORG);
  return g.__orgMem;
}

export async function saveOrg(doc: OrgDoc): Promise<void> {
  if (kvConfigured()) {
    await kv.set(KEY, doc);
    return;
  }
  g.__orgMem = doc;
}

export type Role = "admin" | "staff" | null;

export async function authenticate(id: string, pin: string): Promise<{ role: Role; name: string }> {
  const org = await getOrg();
  const cleanId = (id || "").trim().toUpperCase();
  if (cleanId === org.adminId.toUpperCase() && pin === org.adminPin) {
    return { role: "admin", name: org.adminName };
  }
  const s = org.staff.find((x) => x.id.toUpperCase() === cleanId);
  if (s && pin === s.pin) return { role: "staff", name: s.name || s.id };
  return { role: null, name: "" };
}
