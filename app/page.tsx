"use client";

import { useEffect, useMemo, useState } from "react";
import { solve, summarize, DAYS } from "@/lib/solver";
import { Config, Lean, Staff, TimeOff } from "@/lib/types";

const PALETTE = [
  "#F4C6DA", "#D8C6F0", "#FBE39A", "#F7CB98", "#F4A6A6", "#9BE5EE",
  "#BFE0F6", "#F3E4B4", "#C9E7BC", "#F1B9CA", "#C9D6F0", "#E8D2B2",
];
const colorFor = (i: number) => PALETTE[i % PALETTE.length];
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_START = 8;
const NIGHT_START = 20;
const OT_THRESHOLD = 40; // hours per week before overtime

const ROSTER_KEY = "sa_roster_v1";
const LOG_KEY = "sa_hourslog_v1";

interface RosterRow { id: string; name: string; pref: string; min: string; max: string; lean: Lean; }

interface Request {
  id: string;
  day: number;
  kind: "all" | "day" | "night" | "custom";
  from: string;
  to: string;
}

// One saved week in the hours log.
interface LoggedWeek {
  weekStart: string; // ISO date
  hours: Record<string, number>; // initials -> hours
  names: Record<string, string>; // initials -> name at time of save
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

const defaultCoverage = () => Array.from({ length: DAYS }, () => ["2", "2"]);

function toNum(v: string, fallback = 0): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) return fallback;
  return Math.min(n, 96);
}

function fmtHour(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  let base = h % 12; if (base === 0) base = 12;
  return `${base} ${suffix}`;
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

function expandRequests(reqs: Request[]): TimeOff[] {
  const out: TimeOff[] = [];
  for (const r of reqs) {
    if (r.kind !== "custom") { out.push({ id: r.id, day: r.day, shift: r.kind }); continue; }
    const from = parseInt(r.from.split(":")[0], 10) + parseInt(r.from.split(":")[1], 10) / 60;
    const to = parseInt(r.to.split(":")[0], 10) + parseInt(r.to.split(":")[1], 10) / 60;
    if (!(to > from)) continue;
    const overlaps = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
    if (overlaps(from, to, DAY_START, NIGHT_START)) out.push({ id: r.id, day: r.day, shift: "day" });
    if (overlaps(from, to, NIGHT_START, 24)) out.push({ id: r.id, day: r.day, shift: "night" });
    if (overlaps(from, to, 0, DAY_START) && r.day > 0) out.push({ id: r.id, day: r.day - 1, shift: "night" });
  }
  return out;
}

export default function Page() {
  const [tab, setTab] = useState<"build" | "ledger">("build");
  const [weekStart, setWeekStart] = useState("2026-07-17");
  const [staff, setStaff] = useState<RosterRow[]>(START_ROSTER);
  const [coverage, setCoverage] = useState<string[][]>(defaultCoverage());
  const [requests, setRequests] = useState<Request[]>([]);
  const [result, setResult] = useState<ReturnType<typeof solve> | null>(null);
  const [cfgUsed, setCfgUsed] = useState<Config | null>(null);
  const [log, setLog] = useState<LoggedWeek[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveNote, setSaveNote] = useState("");

  // Load saved roster and hours log once, on this device.
  useEffect(() => {
    try {
      const r = localStorage.getItem(ROSTER_KEY);
      if (r) {
        const parsed = JSON.parse(r);
        if (Array.isArray(parsed) && parsed.length) setStaff(parsed);
      }
      const l = localStorage.getItem(LOG_KEY);
      if (l) {
        const parsed = JSON.parse(l);
        if (Array.isArray(parsed)) setLog(parsed);
      }
    } catch { /* fresh start if storage is unreadable */ }
    setLoaded(true);
  }, []);

  // Persist roster edits so names and hours survive between visits.
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

  const capacity = useMemo(() => {
    let needed = 0;
    for (const day of coverage) for (const c of day) needed += toNum(c, 2);
    let minS = 0, maxS = 0, prefS = 0;
    for (const s of staff) {
      minS += Math.ceil(toNum(s.min) / 12);
      maxS += Math.floor(toNum(s.max) / 12);
      prefS += Math.round(toNum(s.pref) / 12);
    }
    return { needed, minS, maxS, prefS };
  }, [staff, coverage]);

  function updateStaff(i: number, patch: Partial<RosterRow>) {
    setStaff((s) => s.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  }
  function removeStaff(i: number) { setStaff((s) => s.filter((_, k) => k !== i)); }
  function addStaff() {
    setStaff((s) => [...s, { id: "NEW", name: "", pref: "24", min: "12", max: "36", lean: "any" }]);
  }
  function setCov(d: number, s: number, v: string) {
    setCoverage((c) => c.map((day, di) => di === d ? day.map((x, si) => si === s ? v.replace(/[^0-9]/g, "") : x) : day));
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
    const cov = coverage.map((day) => day.map((c) => toNum(c, 2)));
    const cfg: Config = {
      staff: cleanStaff,
      dayStartHour: DAY_START,
      nightStartHour: NIGHT_START,
      shiftLengthHours: 12,
      coverage: cov,
      timeOff: expandRequests(requests),
      locked: [],
      weights: { hours: 100, night: 8, weekend: 6, lean: 4 },
      weekendDays,
      seed: Math.floor(Math.random() * 1e9),
    };
    setCfgUsed(cfg);
    try {
      setResult(solve(cfg, 300));
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
    const entry: LoggedWeek = {
      weekStart,
      hours: stats.hours,
      names,
      savedAt: new Date().toISOString(),
    };
    setLog((l) => {
      const others = l.filter((w) => w.weekStart !== weekStart);
      return [...others, entry].sort((a, b) => a.weekStart < b.weekStart ? 1 : -1);
    });
    setSaveNote(`Week of ${weekLabel(weekStart)} saved to the ledger.`);
  }

  function deleteWeek(ws: string) {
    setLog((l) => l.filter((w) => w.weekStart !== ws));
  }

  const colorIndex = useMemo(() => {
    const m: Record<string, number> = {};
    staff.forEach((s, i) => (m[s.id] = i));
    return m;
  }, [staff]);

  const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();
  const capBad = capacity.minS > capacity.needed || capacity.maxS < capacity.needed;

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
          day {fmtHour(DAY_START)} to {fmtHour(NIGHT_START)} · night {fmtHour(NIGHT_START)} to {fmtHour(DAY_START)}
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
            <h2>Staff On Per Shift</h2>
            <table className="covgrid">
              <thead>
                <tr>
                  <th></th>
                  {Array.from({ length: DAYS }).map((_, d) => {
                    const dt = addDays(weekStart, d);
                    return <th key={d}>{DAY_ABBR[dt.getDay()]}<br /><span className="date">{dt.getMonth() + 1}/{dt.getDate()}</span></th>;
                  })}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="covlabel">Day</td>
                  {coverage.map((day, d) => (
                    <td key={d}><input type="text" inputMode="numeric" pattern="[0-9]*" value={day[0]} onFocus={selectAll} onChange={(e) => setCov(d, 0, e.target.value)} /></td>
                  ))}
                </tr>
                <tr>
                  <td className="covlabel">Night</td>
                  {coverage.map((day, d) => (
                    <td key={d}><input type="text" inputMode="numeric" pattern="[0-9]*" value={day[1]} onFocus={selectAll} onChange={(e) => setCov(d, 1, e.target.value)} /></td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="covnote">Default is two on every shift. Raise any box for heavier days.</p>
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
              This week asks for {capacity.needed} shifts · minimums claim {capacity.minS} · maximums allow {capacity.maxS} · targets total {capacity.prefS}
              {capacity.minS > capacity.needed && <span> — minimums exceed the week, lower some Min hours</span>}
              {capacity.maxS < capacity.needed && <span> — maximums cannot cover the week, raise some Max hours or add staff</span>}
            </div>
          </div>

          <div className="panel">
            <h2>Time Off Requests</h2>
            {requests.length === 0 && (
              <p style={{ fontSize: 12, color: "var(--ink-soft)", margin: "0 0 10px" }}>
                None yet. Block a whole day, one shift, or a window like an appointment.
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
                    <span className="reqnote">
                      blocks: {expandRequests([req]).map((t) => `${t.shift} shift`).join(" + ") || "nothing yet"}
                    </span>
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
                Set your coverage, roster, and requests, then generate.<br />
                Every schedule is checked against every hard rule before it appears.
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
              <div className="problem" style={{ borderColor: "var(--line)", color: "var(--ink-soft)", background: "var(--card)" }}>
                Quick math: this week asks for {capacity.needed} shifts. Your minimums claim {capacity.minS} and your
                maximums allow {capacity.maxS}. Requests off shrink what is possible further. Adjust and generate again.
              </div>
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
  const idOf = (e: number) => cfg.staff[e].id;

  const grid: string[][][] = [];
  for (let d = 0; d < DAYS; d++) {
    grid[d] = [[], []];
    for (let s = 0; s < 2; s++) {
      for (let e = 0; e < cfg.staff.length; e++) {
        if (sol.assign[e][d][s]) grid[d][s].push(idOf(e));
      }
    }
  }
  const allCovered = grid.every((day, d) => day.every((slot, s) => slot.length === cfg.coverage[d][s]));

  const chip = (id: string) => (
    <span className="chip" key={id} style={{ background: colorFor(colorIndex[id] ?? 0) }}>{id}</span>
  );

  return (
    <div>
      <div className="sealbar">
        <span className={`dot ${allCovered ? "good" : "warn"}`} />
        <span className="label">
          {allCovered ? "Coverage verified · every shift fully staffed" : "Coverage gap detected"}
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
  // Running totals across every saved week.
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
    // Prefer the current roster name when one is set.
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
