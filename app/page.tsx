"use client";

import { useEffect, useMemo, useState } from "react";
import { solve, summarize, DAYS, BLOCKS, BLOCK_HOURS, FLOOR } from "@/lib/solver";
import { Config, Lean, Staff, BlockOff } from "@/lib/types";

const PALETTE = [
  "#F4C6DA", "#D8C6F0", "#FBE39A", "#F7CB98", "#F4A6A6", "#9BE5EE",
  "#BFE0F6", "#F3E4B4", "#C9E7BC", "#F1B9CA", "#C9D6F0", "#E8D2B2",
];
const colorFor = (i: number) => PALETTE[i % PALETTE.length];
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const OT_THRESHOLD = 40;
const ROSTER_KEY = "sa_roster_v1";
const LOG_KEY = "sa_hourslog_v1";

// Block time ranges: [start, end) in hours from midnight of that day.
// Block 2 crosses midnight; block 3 lives in the next calendar morning.
const BLOCK_LABEL = ["8a–2p", "2p–8p", "8p–2a", "2a–8a"];

interface RosterRow { id: string; name: string; pref: string; min: string; max: string; lean: Lean; }

interface Request {
  id: string;
  day: number;
  kind: "all" | "day" | "night" | "custom";
  from: string;
  to: string;
}

interface LoggedWeek {
  weekStart: string;
  hours: Record<string, number>;
  names: Record<string, string>;
  savedAt: string;
}

const START_ROSTER: RosterRow[] = [
  { id: "CT", name: "", pref: "36", min: "24", max: "48", lean: "day" },
  { id: "CM", name: "", pref: "24", min: "12", max: "36", lean: "day" },
  { id: "AT", name: "", pref: "36", min: "24", max: "48", lean: "day" },
  { id: "AD", name: "", pref: "36", min: "24", max: "48", lean: "any" },
  { id: "KH", name: "", pref: "24", min: "12", max: "36", lean: "day" },
  { id: "EH", name: "", pref: "36", min: "24", max: "48", lean: "night" },
  { id: "SL", name: "", pref: "36", min: "24", max: "48", lean: "night" },
  { id: "WR", name: "", pref: "36", min: "24", max: "48", lean: "night" },
  { id: "VT", name: "", pref: "24", min: "12", max: "36", lean: "night" },
  { id: "R1", name: "", pref: "24", min: "12", max: "36", lean: "any" },
  { id: "R2", name: "", pref: "24", min: "12", max: "36", lean: "any" },
  { id: "R3", name: "", pref: "24", min: "12", max: "36", lean: "any" },
];

function toNum(v: string, fallback = 0): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) return fallback;
  return Math.min(n, 96);
}
function fmtClock(t: string): string {
  const [hs, ms] = t.split(":");
  let h = parseInt(hs, 10);
  const suffix = h < 12 ? "a" : "p";
  h = h % 12; if (h === 0) h = 12;
  return ms === "00" ? `${h}${suffix}` : `${h}:${ms}${suffix}`;
}
function addDays(iso: string, n: number): Date {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d;
}
function weekLabel(iso: string): string {
  const a = addDays(iso, 0), b = addDays(iso, 6);
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${a.toLocaleDateString("en-US", opt)} to ${b.toLocaleDateString("en-US", opt)}`;
}

// Turn requests into block-level holds. Custom windows hit exactly the blocks
// they overlap: an 8a-12p appointment blocks the morning half only, so the
// person can still take 2p-8p that day.
function expandRequests(reqs: Request[]): BlockOff[] {
  const out: BlockOff[] = [];
  const push = (id: string, day: number, block: number) => {
    if (day >= 0 && day < DAYS) out.push({ id, day, block });
  };
  for (const r of reqs) {
    if (r.kind === "all") { for (let b = 0; b < BLOCKS; b++) push(r.id, r.day, b); continue; }
    if (r.kind === "day") { push(r.id, r.day, 0); push(r.id, r.day, 1); continue; }
    if (r.kind === "night") { push(r.id, r.day, 2); push(r.id, r.day, 3); continue; }
    const from = parseInt(r.from.split(":")[0], 10) + parseInt(r.from.split(":")[1], 10) / 60;
    const to = parseInt(r.to.split(":")[0], 10) + parseInt(r.to.split(":")[1], 10) / 60;
    if (!(to > from)) continue;
    const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
    if (overlaps(from, to, 8, 14)) push(r.id, r.day, 0);
    if (overlaps(from, to, 14, 20)) push(r.id, r.day, 1);
    if (overlaps(from, to, 20, 24)) push(r.id, r.day, 2);
    if (overlaps(from, to, 0, 2)) push(r.id, r.day - 1, 2);
    if (overlaps(from, to, 2, 8)) push(r.id, r.day - 1, 3);
  }
  return out;
}

function describeBlocks(bo: BlockOff[]): string {
  if (!bo.length) return "nothing yet";
  return bo.map((x) => BLOCK_LABEL[x.block]).join(" + ");
}

export default function Page() {
  const [tab, setTab] = useState<"build" | "ledger">("build");
  const [weekStart, setWeekStart] = useState("2026-07-17");
  const [staff, setStaff] = useState<RosterRow[]>(START_ROSTER);
  const [requests, setRequests] = useState<Request[]>([]);
  const [result, setResult] = useState<ReturnType<typeof solve> | null>(null);
  const [cfgUsed, setCfgUsed] = useState<Config | null>(null);
  const [log, setLog] = useState<LoggedWeek[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveNote, setSaveNote] = useState("");

  useEffect(() => {
    try {
      const r = localStorage.getItem(ROSTER_KEY);
      if (r) {
        const parsed = JSON.parse(r);
        if (Array.isArray(parsed) && parsed.length) {
          setStaff(parsed.map((x: Partial<RosterRow>) => ({
            id: x.id ?? "??", name: x.name ?? "", pref: x.pref ?? "24",
            min: x.min ?? "12", max: x.max ?? "36", lean: x.lean ?? "any",
          })));
        }
      }
      const l = localStorage.getItem(LOG_KEY);
      if (l) {
        const parsed = JSON.parse(l);
        if (Array.isArray(parsed)) setLog(parsed);
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(staff)); } catch {}
  }, [staff, loaded]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch {}
  }, [log, loaded]);

  const startDow = useMemo(() => new Date(weekStart + "T00:00:00").getDay(), [weekStart]);
  const weekendDays = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < DAYS; i++) {
      const dow = (startDow + i) % 7;
      if (dow === 0 || dow === 6) out.push(i);
    }
    return out;
  }, [startDow]);

  // Live math in hours, so nothing needs to be worked out by hand.
  const capacity = useMemo(() => {
    const floorHours = DAYS * BLOCKS * FLOOR * BLOCK_HOURS; // 336
    let minH = 0, maxH = 0, prefH = 0;
    for (const s of staff) { minH += toNum(s.min); maxH += toNum(s.max); prefH += toNum(s.pref); }
    return { floorHours, minH, maxH, prefH };
  }, [staff]);

  function updateStaff(i: number, patch: Partial<RosterRow>) {
    setStaff((s) => s.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  }
  function removeStaff(i: number) { setStaff((s) => s.filter((_, k) => k !== i)); }
  function addStaff() {
    setStaff((s) => [...s, { id: "NEW", name: "", pref: "24", min: "12", max: "36", lean: "any" }]);
  }
  function addRequest() {
    setRequests((t) => [...t, { id: staff[0]?.id || "", day: 0, kind: "all", from: "08:00", to: "12:00" }]);
  }
  function updateRequest(i: number, patch: Partial<Request>) {
    setRequests((t) => t.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  }
  function removeRequest(i: number) { setRequests((t) => t.filter((_, k) => k !== i)); }

  function generate() {
    setSaveNote("");
    const cleanStaff: Staff[] = staff.map((s) => ({
      id: s.id.trim() || "??",
      name: s.name.trim(),
      pref: toNum(s.pref),
      min: toNum(s.min),
      max: toNum(s.max),
      lean: s.lean,
    }));
    const cfg: Config = {
      staff: cleanStaff,
      blockOff: expandRequests(requests),
      weights: { hours: 100, night: 8, weekend: 6, lean: 4, fragment: 3 },
      weekendDays,
      seed: Math.floor(Math.random() * 1e9),
    };
    setCfgUsed(cfg);
    try {
      setResult(solve(cfg, 350));
    } catch (err) {
      setResult({
        status: "INVALID",
        problems: ["Something in the inputs broke the engine: " + String(err) + ". Check for blank initials or hours and generate again."],
      });
    }
  }

  function logWeek() {
    if (!result || result.status !== "OK" || !cfgUsed) return;
    const stats = summarize(cfgUsed, result.sol);
    const names: Record<string, string> = {};
    for (const s of cfgUsed.staff) names[s.id] = s.name || "";
    const entry: LoggedWeek = { weekStart, hours: stats.hours, names, savedAt: new Date().toISOString() };
    setLog((l) => {
      const others = l.filter((w) => w.weekStart !== weekStart);
      return [...others, entry].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
    });
    setSaveNote(`Week of ${weekLabel(weekStart)} saved to the ledger.`);
  }

  function deleteWeek(ws: string) { setLog((l) => l.filter((w) => w.weekStart !== ws)); }

  const colorIndex = useMemo(() => {
    const m: Record<string, number> = {};
    staff.forEach((s, i) => (m[s.id] = i));
    return m;
  }, [staff]);

  const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();
  const capBad = capacity.maxH < capacity.floorHours;

  return (
    <div className="wrap">
      <div className="masthead">
        <div>
          <p className="eyebrow">Operations · Coverage Engine</p>
          <h1>Schedule Automator</h1>
        </div>
        <div className="meta">
          <span className="big">{weekLabel(weekStart)}</span>
          <br />
          at least two on the floor, around the clock · staffing adjusts itself to hours and requests
        </div>
      </div>
      <div className="tabs">
        <button className={tab === "build" ? "on" : ""} onClick={() => setTab("build")}>Build schedule</button>
        <button className={tab === "ledger" ? "on" : ""} onClick={() => setTab("ledger")}>Hours ledger{log.length ? ` (${log.length})` : ""}</button>
      </div>
      <div className="hairline" />

      {tab === "ledger" && <LedgerView log={log} staff={staff} colorIndex={colorIndex} onDelete={deleteWeek} />}

      {tab === "build" && (
      <div className="layout">
        <div>
          <div className="panel">
            <h2>Week</h2>
            <div className="field">
              <label>Week starts</label>
              <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            </div>
          </div>

          <div className="panel">
            <h2>Roster · Weekly Hours</h2>
            <table className="roster">
              <thead>
                <tr>
                  <th></th><th>ID</th><th>Name</th><th>Pref</th><th>Min</th><th>Max</th><th>Lean</th><th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map((row, i) => (
                  <tr key={i}>
                    <td><span className="swatch" style={{ background: colorFor(i) }} /></td>
                    <td className="idcell" style={{ width: 40 }}>
                      <input type="text" value={row.id} maxLength={4} onFocus={selectAll}
                        onChange={(e) => updateStaff(i, { id: e.target.value.toUpperCase() })} />
                    </td>
                    <td style={{ minWidth: 76 }}>
                      <input type="text" value={row.name} placeholder="name"
                        onChange={(e) => updateStaff(i, { name: e.target.value })} />
                    </td>
                    <td style={{ width: 44 }}>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={row.pref} onFocus={selectAll}
                        onChange={(e) => updateStaff(i, { pref: e.target.value.replace(/[^0-9]/g, "") })} />
                    </td>
                    <td style={{ width: 44 }}>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={row.min} onFocus={selectAll}
                        onChange={(e) => updateStaff(i, { min: e.target.value.replace(/[^0-9]/g, "") })} />
                    </td>
                    <td style={{ width: 44 }}>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={row.max} onFocus={selectAll}
                        onChange={(e) => updateStaff(i, { max: e.target.value.replace(/[^0-9]/g, "") })} />
                    </td>
                    <td>
                      <select value={row.lean} onChange={(e) => updateStaff(i, { lean: e.target.value as Lean })}>
                        <option value="day">day</option>
                        <option value="night">night</option>
                        <option value="any">any</option>
                      </select>
                    </td>
                    <td><button className="rowdrop" onClick={() => removeStaff(i)} title="Remove">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="addrow" onClick={addStaff}>+ Add staff</button>
            <div className={`capline ${capBad ? "bad" : ""}`}>
              Set each person&apos;s hours; staffing per shift works itself out. Hours land in 6-hour steps.
              Keeping two on all week takes {capacity.floorHours} staff-hours · your minimums claim {capacity.minH} · maximums allow {capacity.maxH}
              {capBad && <span> — maximums cannot hold the floor, raise some Max hours or add staff</span>}
            </div>
          </div>

          <div className="panel">
            <h2>Time Off Requests</h2>
            {requests.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 10px" }}>
                None yet. Block a whole day, one shift, or a window like an appointment.
                A partial window only blocks the half-shifts it touches.
              </p>
            )}
            {requests.map((req, i) => (
              <div className="reqblock" key={i}>
                <div className="reqrow">
                  <select value={req.id} onChange={(e) => updateRequest(i, { id: e.target.value })}>
                    {staff.map((s, k) => <option key={k} value={s.id}>{s.id}</option>)}
                  </select>
                  <select value={req.day} onChange={(e) => updateRequest(i, { day: +e.target.value })}>
                    {Array.from({ length: DAYS }).map((_, d) => {
                      const dt = addDays(weekStart, d);
                      return <option key={d} value={d}>{DAY_ABBR[dt.getDay()]} {dt.getMonth() + 1}/{dt.getDate()}</option>;
                    })}
                  </select>
                  <select value={req.kind} onChange={(e) => updateRequest(i, { kind: e.target.value as Request["kind"] })}>
                    <option value="all">all day</option>
                    <option value="day">day shift</option>
                    <option value="night">night shift</option>
                    <option value="custom">custom hours</option>
                  </select>
                  <button className="rowdrop" onClick={() => removeRequest(i)} title="Remove">×</button>
                </div>
                {req.kind === "custom" && (
                  <div className="reqtimes">
                    <input type="time" value={req.from} onChange={(e) => updateRequest(i, { from: e.target.value })} />
                    <span>to</span>
                    <input type="time" value={req.to} onChange={(e) => updateRequest(i, { to: e.target.value })} />
                    <span className="reqnote">holds: {describeBlocks(expandRequests([req]))}</span>
                  </div>
                )}
              </div>
            ))}
            <button className="addrow" onClick={addRequest}>+ Add request</button>
          </div>

          <button className="generate" onClick={generate}>Generate schedule</button>
        </div>

        <div className="result">
          {!result && (
            <div className="panel">
              <div className="empty">
                Set hours and requests, then generate.<br />
                The engine keeps at least two on at all times and decides on its own when a
                third person or a split shift is needed to land everyone&apos;s hours.
              </div>
            </div>
          )}

          {result && (result.status === "INVALID" || result.status === "INFEASIBLE") && (
            <div>
              <div className="sealbar">
                <span className="dot warn" />
                <span className="label">No valid schedule exists for these inputs</span>
              </div>
              {result.problems.map((p, i) => <div className="problem" key={i}>{p}</div>)}
            </div>
          )}

          {result && result.status === "OK" && cfgUsed && (
            <ResultView cfg={cfgUsed} result={result} colorIndex={colorIndex} weekStart={weekStart}
              requests={requests} onLog={logWeek} saveNote={saveNote} />
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// A person's presence on one side (day or night) of one date, with real times.
function presence(day: boolean[], side: "day" | "night"): string | null {
  const [a, b] = side === "day" ? [day[0], day[1]] : [day[2], day[3]];
  if (a && b) return side === "day" ? "8a–8p" : "8p–8a";
  if (a) return side === "day" ? "8a–2p" : "8p–2a";
  if (b) return side === "day" ? "2p–8p" : "2a–8a";
  return null;
}

function ResultView({
  cfg, result, colorIndex, weekStart, requests, onLog, saveNote,
}: {
  cfg: Config;
  result: Extract<ReturnType<typeof solve>, { status: "OK" }>;
  colorIndex: Record<string, number>;
  weekStart: string;
  requests: Request[];
  onLog: () => void;
  saveNote: string;
}) {
  const { sol } = result;
  const stats = summarize(cfg, sol);

  // Grid cells: for each day and side, who is on and at what times.
  const grid: { id: string; when: string }[][][] = [];
  for (let d = 0; d < DAYS; d++) {
    grid[d] = [[], []];
    for (let e = 0; e < cfg.staff.length; e++) {
      const pDay = presence(sol.assign[e][d], "day");
      const pNight = presence(sol.assign[e][d], "night");
      if (pDay) grid[d][0].push({ id: cfg.staff[e].id, when: pDay });
      if (pNight) grid[d][1].push({ id: cfg.staff[e].id, when: pNight });
    }
  }
  // Floor check straight from the blocks.
  let floorOk = true;
  for (let d = 0; d < DAYS && floorOk; d++) {
    for (let b = 0; b < BLOCKS; b++) {
      let c = 0;
      for (let e = 0; e < cfg.staff.length; e++) if (sol.assign[e][d][b]) c++;
      if (c < FLOOR) { floorOk = false; break; }
    }
  }

  const chip = (p: { id: string; when: string }, k: number) => (
    <span className="chip" key={k} style={{ background: colorFor(colorIndex[p.id] ?? 0) }}>
      {p.id}<span className="chiptime">{p.when}</span>
    </span>
  );

  return (
    <div>
      <div className="sealbar">
        <span className={`dot ${floorOk ? "good" : "warn"}`} />
        <span className="label">
          {floorOk ? "Coverage verified · at least two on, every hour of the week" : "Coverage gap detected"}
        </span>
        <span className="sub">best of {result.feasible.toLocaleString()} valid schedules</span>
      </div>

      <div className="band">
        <table>
          <thead>
            <tr>
              <th style={{ width: 92 }}></th>
              {Array.from({ length: DAYS }).map((_, d) => {
                const dt = addDays(weekStart, d);
                return (
                  <th key={d}>
                    {DAY_ABBR[dt.getDay()]}
                    <span className="date">{dt.getMonth() + 1}/{dt.getDate()}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="rowhead"><span className="k">Day</span><span className="t">8 AM–8 PM</span></td>
              {grid.map((day, d) => <td className="slot" key={d}>{day[0].map(chip)}</td>)}
            </tr>
            <tr>
              <td className="rowhead"><span className="k">Night</span><span className="t">8 PM–8 AM</span></td>
              {grid.map((day, d) => <td className="slot" key={d}>{day[1].map(chip)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      {requests.length > 0 && (
        <div className="honored">
          Honored requests: {requests.map((r, i) => {
            const dt = addDays(weekStart, r.day);
            const when = r.kind === "custom" ? `${fmtClock(r.from)}–${fmtClock(r.to)}` : r.kind === "all" ? "all day" : r.kind + " shift";
            return <span key={i}>{r.id} out {DAY_ABBR[dt.getDay()]} {dt.getMonth() + 1}/{dt.getDate()} ({when}){i < requests.length - 1 ? " · " : ""}</span>;
          })}
        </div>
      )}

      <div className="ledger">
        <h3>This Week&apos;s Hours</h3>
        <table>
          <thead>
            <tr><th>Staff</th><th>Hours</th><th>Target</th><th>Overtime</th><th>Nights</th><th>Weekend shifts</th></tr>
          </thead>
          <tbody>
            {cfg.staff.map((s, i) => {
              const h = stats.hours[s.id];
              const ot = Math.max(0, h - OT_THRESHOLD);
              const hit = h >= s.min && h <= s.max;
              return (
                <tr key={i}>
                  <td className="id"><span className="sw" style={{ background: colorFor(i) }} />{s.id}{s.name ? ` · ${s.name}` : ""}</td>
                  <td className={hit ? "hit" : "miss"}>{h} h</td>
                  <td>{s.pref} h</td>
                  <td className={ot > 0 ? "ot" : ""}>{ot > 0 ? `${ot} h OT` : "—"}</td>
                  <td>{stats.nights[s.id]}</td>
                  <td>{stats.weekends[s.id]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="tools">
        <button className="primarytool" onClick={onLog}>Save week to hours ledger</button>
        <button onClick={() => window.print()}>Print or save PDF</button>
      </div>
      {saveNote && <div className="savednote">{saveNote} Open the Hours ledger tab to see running totals.</div>}
    </div>
  );
}

function LedgerView({
  log, staff, colorIndex, onDelete,
}: {
  log: LoggedWeek[];
  staff: RosterRow[];
  colorIndex: Record<string, number>;
  onDelete: (ws: string) => void;
}) {
  const totals = useMemo(() => {
    const t: Record<string, { hours: number; ot: number; weeks: number; name: string }> = {};
    for (const w of log) {
      for (const [id, h] of Object.entries(w.hours)) {
        if (!t[id]) t[id] = { hours: 0, ot: 0, weeks: 0, name: w.names[id] || "" };
        t[id].hours += h;
        t[id].ot += Math.max(0, h - OT_THRESHOLD);
        if (h > 0) t[id].weeks += 1;
        if (w.names[id]) t[id].name = w.names[id];
      }
    }
    for (const s of staff) if (t[s.id] && s.name) t[s.id].name = s.name;
    return t;
  }, [log, staff]);

  const ids = Object.keys(totals).sort((a, b) => totals[b].hours - totals[a].hours);

  if (log.length === 0) {
    return (
      <div className="panel">
        <div className="empty">
          No weeks saved yet.<br />
          Generate a schedule, then tap Save week to hours ledger. Every saved week lands here,
          with running totals and overtime tracked per person.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <h2>Running Totals · All Saved Weeks</h2>
        <table className="ledgertable">
          <thead>
            <tr><th>Staff</th><th>Weeks worked</th><th>Total hours</th><th>Total overtime</th></tr>
          </thead>
          <tbody>
            {ids.map((id) => (
              <tr key={id}>
                <td className="id"><span className="sw" style={{ background: colorFor(colorIndex[id] ?? 0) }} />{id}{totals[id].name ? ` · ${totals[id].name}` : ""}</td>
                <td>{totals[id].weeks}</td>
                <td>{totals[id].hours} h</td>
                <td className={totals[id].ot > 0 ? "ot" : ""}>{totals[id].ot > 0 ? `${totals[id].ot} h` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="covnote">Overtime counts hours above {OT_THRESHOLD} in a single week. The ledger lives on this device.</p>
      </div>

      {log.map((w) => (
        <div className="panel" key={w.weekStart}>
          <div className="weekhead">
            <h2>Week of {weekLabel(w.weekStart)}</h2>
            <button className="rowdrop" onClick={() => onDelete(w.weekStart)} title="Delete this week">× remove</button>
          </div>
          <table className="ledgertable">
            <thead>
              <tr><th>Staff</th><th>Hours</th><th>Overtime</th></tr>
            </thead>
            <tbody>
              {Object.entries(w.hours).sort((a, b) => b[1] - a[1]).map(([id, h]) => {
                const ot = Math.max(0, h - OT_THRESHOLD);
                return (
                  <tr key={id}>
                    <td className="id"><span className="sw" style={{ background: colorFor(colorIndex[id] ?? 0) }} />{id}{w.names[id] ? ` · ${w.names[id]}` : ""}</td>
                    <td>{h} h</td>
                    <td className={ot > 0 ? "ot" : ""}>{ot > 0 ? `${ot} h` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
