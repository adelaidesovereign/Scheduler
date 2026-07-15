"use client";

import { useEffect, useMemo, useState } from "react";

interface PortalRequest {
  key: string; id: string; date: string;
  kind: "all" | "day" | "night" | "custom";
  from: string; to: string; submittedAt: string;
}

function nextMonthISO(): string {
  const d = new Date();
  d.setDate(1); d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthDays(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const out: string[] = [];
  const d = new Date(y, m - 1, 1);
  while (d.getMonth() === m - 1) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function prettyDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtClock(t: string): string {
  const [hs, ms] = t.split(":");
  let h = parseInt(hs, 10);
  const suf = h < 12 ? "a" : "p";
  h = h % 12; if (h === 0) h = 12;
  return ms === "00" ? `${h}${suf}` : `${h}:${ms}${suf}`;
}

export default function Portal() {
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [me, setMe] = useState<{ id: string; pin: string; name: string; role: string } | null>(null);
  const [err, setErr] = useState("");
  const [month, setMonth] = useState(nextMonthISO());
  const [mine, setMine] = useState<PortalRequest[]>([]);
  const [pickDate, setPickDate] = useState("");
  const [kind, setKind] = useState<"all" | "day" | "night" | "custom">("all");
  const [from, setFrom] = useState("08:00");
  const [to, setTo] = useState("12:00");
  const [note, setNote] = useState("");

  const days = useMemo(() => monthDays(month), [month]);
  const hdrs: Record<string, string> = me ? { "x-id": me.id, "x-pin": me.pin } : {};

  async function login() {
    setErr("");
    const res = await fetch("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pin }),
    });
    const data = await res.json();
    if (!data.ok) { setErr(data.error || "Could not sign in."); return; }
    setMe({ id: id.trim().toUpperCase(), pin, name: data.name, role: data.role });
  }

  async function loadMine(m: { id: string; pin: string }) {
    const res = await fetch(`/api/requests?from=${days[0]}&to=${days[days.length - 1]}`, {
      headers: { "x-id": m.id, "x-pin": m.pin },
    });
    const data = await res.json();
    if (data.ok) setMine(data.requests);
  }

  useEffect(() => { if (me) loadMine(me); /* eslint-disable-next-line */ }, [me, month]);

  async function submit() {
    if (!me || !pickDate) return;
    setNote("");
    const res = await fetch("/api/requests", {
      method: "POST", headers: { "Content-Type": "application/json", ...hdrs },
      body: JSON.stringify({ date: pickDate, kind, from, to }),
    });
    const data = await res.json();
    if (!data.ok) { setNote(data.error || "Could not save."); return; }
    setNote(`Saved: out ${prettyDate(pickDate)}.`);
    setPickDate("");
    loadMine(me);
  }

  async function remove(key: string) {
    if (!me) return;
    await fetch(`/api/requests?key=${encodeURIComponent(key)}`, { method: "DELETE", headers: hdrs });
    loadMine(me);
  }

  if (!me) {
    return (
      <div className="wrap portalwrap">
        <div className="masthead"><div>
          <p className="eyebrow">Staff Portal</p>
          <h1>Time Off Requests</h1>
        </div></div>
        <div className="hairline" />
        <div className="panel portalcard">
          <h2>Sign In</h2>
          <div className="field"><label>Your initials</label>
            <input type="text" value={id} maxLength={4} onChange={(e) => setId(e.target.value.toUpperCase())} /></div>
          <div className="field"><label>Your PIN</label>
            <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></div>
          {err && <div className="problem">{err}</div>}
          <button className="generate" onClick={login}>Sign in</button>
        </div>
      </div>
    );
  }

  const requestedDates = new Set(mine.map((r) => r.date));

  return (
    <div className="wrap portalwrap">
      <div className="masthead"><div>
        <p className="eyebrow">Staff Portal · {me.name || me.id}</p>
        <h1>Time Off Requests</h1>
      </div></div>
      <div className="hairline" />

      <div className="panel portalcard">
        <h2>Month</h2>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <div className="panel portalcard">
        <h2>Tap a day to request it off</h2>
        <div className="caldow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="calgrid">
          {Array.from({ length: new Date(days[0] + "T00:00:00").getDay() }).map((_, i) => <span key={"pad" + i} />)}
          {days.map((d) => (
            <button key={d}
              className={"calday" + (requestedDates.has(d) ? " req" : "") + (pickDate === d ? " picked" : "")}
              onClick={() => setPickDate(d)}>
              {parseInt(d.slice(8), 10)}
            </button>
          ))}
        </div>
        {pickDate && (
          <div className="pickpane">
            <div className="pickdate">{prettyDate(pickDate)}</div>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="all">whole day off</option>
              <option value="day">day shift off</option>
              <option value="night">night shift off</option>
              <option value="custom">specific hours</option>
            </select>
            {kind === "custom" && (
              <div className="reqtimes">
                <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
                <span>to</span>
                <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            )}
            <button className="generate" onClick={submit}>Submit request</button>
          </div>
        )}
        {note && <div className="savednote">{note}</div>}
      </div>

      <div className="panel portalcard">
        <h2>Your requests this month</h2>
        {mine.length === 0 && <p className="covnote">None yet.</p>}
        {mine.sort((a, b) => a.date.localeCompare(b.date)).map((r) => (
          <div className="reqline" key={r.key}>
            <span>{prettyDate(r.date)} · {r.kind === "custom" ? `${fmtClock(r.from)}–${fmtClock(r.to)}` : r.kind === "all" ? "whole day" : r.kind + " shift"}</span>
            <button className="rowdrop" onClick={() => remove(r.key)}>× remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
