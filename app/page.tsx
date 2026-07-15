"use client";

import { useEffect, useMemo, useState } from "react";
import { solve, summarize, DAYS, BLOCKS } from "@/lib/solver";
import { Config, Side, Staff, BlockOff } from "@/lib/types";

const PALETTE = [
  "#F4C6DA", "#D8C6F0", "#FBE39A", "#F7CB98", "#F4A6A6", "#9BE5EE",
  "#BFE0F6", "#F3E4B4", "#C9E7BC", "#F1B9CA", "#C9D6F0", "#E8D2B2",
];
const colorFor = (i: number) => PALETTE[i % PALETTE.length];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OT_THRESHOLD = 40;
const APP_VERSION = "v10";
const ROSTER_KEY = "sa_roster_v3";
const LOG_KEY = "sa_hourslog_v1";
const ADMIN_KEY = "sa_admin_v1";

interface RosterRow {
  id: string; name: string; pin: string; notes: string;
  side: Side; empType: "FT" | "PT"; anchor: boolean; primary: boolean; stretch: "8" | "12";
  pref: string; min: string; max: string;
  avail: boolean[][]; // [weekday Sun..Sat][slot: 8a-12p, 12p-4p, 4p-8p, night]
}

const fullAvail = (): boolean[][] => Array.from({ length: 7 }, () => [true, true, true, true]);
const AVAIL_SLOTS = ["8a–12p", "12p–4p", "4p–8p", "Night"];
const DOW_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
interface AdminRequest {
  key: string; id: string; date: string;
  kind: "all" | "day" | "night" | "custom"; from: string; to: string;
  source: "admin" | "portal";
}
interface LoggedWeek { weekStart: string; hours: Record<string, number>; names: Record<string, string>; savedAt: string; }
interface WeekResult { weekStart: string; cfg: Config; result: ReturnType<typeof solve>; }

const DEFAULT_ROSTER: RosterRow[] = [
  { id: "AT", name: "", pin: "1111", notes: "", side: "day", empType: "FT", anchor: true, primary: true, stretch: "12", pref: "36", min: "36", max: "48", avail: fullAvail() },
  { id: "CT", name: "", pin: "1111", notes: "", side: "day", empType: "FT", anchor: true, primary: true, stretch: "12", pref: "36", min: "36", max: "48", avail: fullAvail() },
  { id: "CM", name: "", pin: "1111", notes: "", side: "day", empType: "FT", anchor: true, primary: false, stretch: "12", pref: "32", min: "24", max: "40", avail: fullAvail() },
  { id: "AD", name: "", pin: "1111", notes: "", side: "day", empType: "PT", anchor: false, primary: false, stretch: "8", pref: "32", min: "24", max: "40", avail: fullAvail() },
  { id: "KH", name: "", pin: "1111", notes: "", side: "day", empType: "PT", anchor: false, primary: false, stretch: "8", pref: "24", min: "16", max: "32", avail: fullAvail() },
  { id: "WR", name: "", pin: "1111", notes: "", side: "night", empType: "FT", anchor: false, primary: false, stretch: "12", pref: "36", min: "36", max: "48", avail: fullAvail() },
  { id: "EH", name: "", pin: "1111", notes: "", side: "night", empType: "FT", anchor: false, primary: false, stretch: "12", pref: "36", min: "36", max: "48", avail: fullAvail() },
  { id: "SL", name: "", pin: "1111", notes: "", side: "night", empType: "PT", anchor: false, primary: false, stretch: "12", pref: "24", min: "12", max: "36", avail: fullAvail() },
  { id: "VT", name: "", pin: "1111", notes: "", side: "night", empType: "PT", anchor: false, primary: false, stretch: "12", pref: "24", min: "12", max: "36", avail: fullAvail() },
  { id: "YN", name: "", pin: "1111", notes: "", side: "night", empType: "PT", anchor: false, primary: false, stretch: "12", pref: "24", min: "12", max: "36", avail: fullAvail() },
];

// Rules for known initials, used when migrating an older saved roster.
const KNOWN: Record<string, Partial<RosterRow>> = Object.fromEntries(
  DEFAULT_ROSTER.map((r) => [r.id, { side: r.side, empType: r.empType, anchor: r.anchor, primary: r.primary, stretch: r.stretch }])
);

function toNum(v: string, fb = 0): number {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) return fb;
  return Math.min(n, 96);
}
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dowOf(iso: string): number { return new Date(iso + "T00:00:00").getDay(); }
function prettyDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}
function weekLabel(iso: string): string {
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${new Date(iso + "T00:00:00").toLocaleDateString("en-US", opt)} to ${new Date(addDaysISO(iso, 6) + "T00:00:00").toLocaleDateString("en-US", opt)}`;
}
function fmtClock(t: string): string {
  const [hs, ms] = t.split(":");
  let h = parseInt(hs, 10);
  const suf = h < 12 ? "a" : "p";
  h = h % 12; if (h === 0) h = 12;
  return ms === "00" ? `${h}${suf}` : `${h}:${ms}${suf}`;
}
function diffDays(a: string, b: string): number {
  return Math.round((new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) / 86400000);
}

// Date-based requests to 4-hour holds for one week. Overnight windows
// (like 8p to 8a) wrap correctly instead of being dropped.
function requestsToBlocks(reqs: AdminRequest[], weekStart: string): BlockOff[] {
  const out: BlockOff[] = [];
  const push = (id: string, day: number, block: number) => {
    if (day >= 0 && day < DAYS) out.push({ id, day, block });
  };
  const mapWindow = (id: string, date: string, f: number, t: number) => {
    const di = diffDays(date, weekStart);
    const ov = (a1: number, a2: number, b1: number, b2: number) => a1 < b2 && b1 < a2;
    if (ov(f, t, 8, 12)) push(id, di, 0);
    if (ov(f, t, 12, 16)) push(id, di, 1);
    if (ov(f, t, 16, 20)) push(id, di, 2);
    if (ov(f, t, 20, 24)) push(id, di, 3);
    if (ov(f, t, 0, 4)) push(id, di - 1, 4);
    if (ov(f, t, 4, 8)) push(id, di - 1, 5);
  };
  for (const r of reqs) {
    const di = diffDays(r.date, weekStart);
    if (di < -1 || di > DAYS) continue;
    if (r.kind === "all") { for (let b = 0; b < BLOCKS; b++) push(r.id, di, b); continue; }
    if (r.kind === "day") { push(r.id, di, 0); push(r.id, di, 1); push(r.id, di, 2); continue; }
    if (r.kind === "night") { push(r.id, di, 3); push(r.id, di, 4); push(r.id, di, 5); continue; }
    const f = parseInt(r.from.split(":")[0], 10) + parseInt(r.from.split(":")[1], 10) / 60;
    const t = parseInt(r.to.split(":")[0], 10) + parseInt(r.to.split(":")[1], 10) / 60;
    if (t > f) { mapWindow(r.id, r.date, f, t); }
    else { mapWindow(r.id, r.date, f, 24); mapWindow(r.id, addDaysISO(r.date, 1), 0, t); }
  }
  return out;
}

// Standing weekly availability becomes hard holds for whichever week is built.
function availabilityToBlocks(rows: RosterRow[], weekStart: string): BlockOff[] {
  const out: BlockOff[] = [];
  const startDow = dowOf(weekStart);
  for (const r of rows) {
    if (!r.avail) continue;
    for (let i = 0; i < DAYS; i++) {
      const dow = (startDow + i) % 7;
      const a = r.avail[dow] || [true, true, true, true];
      for (let b = 0; b < 3; b++) if (!a[b]) out.push({ id: r.id.trim().toUpperCase(), day: i, block: b });
      if (!a[3]) for (const b of [3, 4, 5]) out.push({ id: r.id.trim().toUpperCase(), day: i, block: b });
    }
  }
  return out;
}

function rowsToStaff(rows: RosterRow[]): Staff[] {
  return rows.map((r) => ({
    id: r.id.trim().toUpperCase() || "??",
    name: r.name.trim(),
    pref: toNum(r.pref), min: toNum(r.min), max: toNum(r.max),
    side: r.side,
    anchor: r.anchor && r.side !== "night",
    primary: r.primary,
    maxStretchBlocks: r.side === "night" ? 3 : (r.stretch === "12" ? 3 : 2),
  }));
}

export default function Page() {
  const [tab, setTab] = useState<"build" | "staff" | "ledger">("build");
  const [mode, setMode] = useState<"week" | "month">("week");
  const [weekStart, setWeekStart] = useState("2026-07-17");
  const [monthPick, setMonthPick] = useState("2026-08");
  const [staff, setStaff] = useState<RosterRow[]>(DEFAULT_ROSTER);
  const [adminReqs, setAdminReqs] = useState<AdminRequest[]>([]);
  const [results, setResults] = useState<WeekResult[] | null>(null);
  const [genError, setGenError] = useState<string[]>([]);
  const [log, setLog] = useState<LoggedWeek[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveNote, setSaveNote] = useState("");

  useEffect(() => {
    // If the phone cached an old copy of the app, loading new pieces fails.
    // Catch that once and pull the fresh version automatically.
    const onErr = (ev: ErrorEvent) => {
      const msg = String(ev.message || "");
      if ((msg.includes("ChunkLoadError") || msg.includes("Loading chunk")) && !sessionStorage.getItem("sa_reloaded")) {
        sessionStorage.setItem("sa_reloaded", "1");
        location.reload();
      }
    };
    window.addEventListener("error", onErr);
    return () => window.removeEventListener("error", onErr);
  }, []);

  useEffect(() => {
    try {
      const r = localStorage.getItem(ROSTER_KEY);
      if (r) {
        const parsed = JSON.parse(r);
        if (Array.isArray(parsed) && parsed.length) {
          setStaff(parsed.map((x: Partial<RosterRow>) => ({
            id: String(x.id || "??").toUpperCase(), name: x.name || "", pin: x.pin || "1111", notes: x.notes || "",
            side: (x.side as Side) || "day", empType: x.empType === "FT" ? "FT" : "PT",
            anchor: Boolean(x.anchor), primary: Boolean(x.primary), stretch: x.stretch === "12" ? "12" : "8",
            pref: x.pref || "24", min: x.min || "12", max: x.max || "36",
            avail: Array.isArray(x.avail) && x.avail.length === 7 ? x.avail : fullAvail(),
          })));
        }
      } else {
        const old = localStorage.getItem("sa_roster_v1");
        if (old) {
          const p = JSON.parse(old);
          if (Array.isArray(p) && p.length) {
            setStaff(p.map((x: { id?: string; name?: string; pref?: string; min?: string; max?: string }) => {
              const id = String(x.id || "??").toUpperCase();
              const k = KNOWN[id] || {};
              return {
                id, name: x.name || "", pin: "1111", notes: "",
                side: (k.side as Side) || "day", empType: k.empType || "PT",
                anchor: k.anchor ?? false, primary: k.primary ?? false, stretch: k.stretch || "8",
                pref: x.pref || "24", min: x.min || "12", max: x.max || "36",
                avail: fullAvail(),
              };
            }));
          }
        }
      }
      const l = localStorage.getItem(LOG_KEY);
      if (l) { const p = JSON.parse(l); if (Array.isArray(p)) setLog(p); }
      const q = localStorage.getItem("sa_reqs_v1");
      if (q) { const pr = JSON.parse(q); if (Array.isArray(pr)) setAdminReqs(pr); }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) try { localStorage.setItem(ROSTER_KEY, JSON.stringify(staff)); } catch {} }, [staff, loaded]);
  useEffect(() => { if (loaded) try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch {} }, [log, loaded]);
  useEffect(() => { if (loaded) try { localStorage.setItem("sa_reqs_v1", JSON.stringify(adminReqs)); } catch {} }, [adminReqs, loaded]);

  // The date range being scheduled.
  const range = useMemo(() => {
    if (mode === "week") return { from: weekStart, weeks: [weekStart] };
    const first = monthPick + "-01";
    const weeks: string[] = [];
    let cur = first;
    const [y, m] = monthPick.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${monthPick}-${String(lastDay).padStart(2, "0")}`;
    while (cur <= monthEnd) { weeks.push(cur); cur = addDaysISO(cur, 7); }
    return { from: first, weeks };
  }, [mode, weekStart, monthPick]);

  function updateStaff(i: number, patch: Partial<RosterRow>) {
    setStaff((s) => s.map((row, k) => (k === i ? { ...row, ...patch } : row)));
  }
  function removeStaff(i: number) { setStaff((s) => s.filter((_, k) => k !== i)); }
  function addStaff() {
    setStaff((s) => [...s, { id: "NEW", name: "", pin: "1111", notes: "", side: "day", empType: "PT", anchor: false, primary: false, stretch: "8", pref: "24", min: "12", max: "36", avail: fullAvail() }]);
  }
  function addAdminReq() {
    setAdminReqs((t) => [...t, {
      key: "a" + Date.now() + Math.floor(Math.random() * 1e6),
      id: staff[0]?.id || "", date: range.weeks[0], kind: "all", from: "08:00", to: "12:00", source: "admin",
    }]);
  }
  function updateAdminReq(k: string, patch: Partial<AdminRequest>) {
    setAdminReqs((t) => t.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  }
  function removeAdminReq(k: string) { setAdminReqs((t) => t.filter((r) => r.key !== k)); }

  function generate() {
    setSaveNote(""); setGenError([]);
    try {
    const cleanStaff = rowsToStaff(staff);
    const allReqs = adminReqs;
    const out: WeekResult[] = [];
    const carryNights = new Array(cleanStaff.length).fill(0);
    const carryWeekends = new Array(cleanStaff.length).fill(0);
    let extraOff: BlockOff[] = [];

    for (const ws of range.weeks) {
      const wd: number[] = [];
      for (let i = 0; i < DAYS; i++) { const dw = dowOf(addDaysISO(ws, i)); if (dw === 0 || dw === 6) wd.push(i); }
      const cfg: Config = {
        staff: cleanStaff,
        blockOff: [...requestsToBlocks(allReqs, ws), ...availabilityToBlocks(staff, ws), ...extraOff],
        weights: { hours: 100, night: 8, weekend: 6, fragment: 12, crowd: 60 },
        weekendDays: wd,
        dayLabels: Array.from({ length: DAYS }, (_, i) => prettyDate(addDaysISO(ws, i))),
        carryNights: [...carryNights],
        carryWeekends: [...carryWeekends],
        seed: Math.floor(Math.random() * 1e9),
      };
      let res: ReturnType<typeof solve>;
      try { res = solve(cfg, mode === "month" ? 350 : 450); }
      catch (err) { res = { status: "INVALID", problems: ["Engine error: " + String(err)] }; }
      out.push({ weekStart: ws, cfg, result: res });
      if (res.status !== "OK") {
        setGenError([`Week of ${weekLabel(ws)} could not be scheduled.`, ...res.problems]);
        break;
      }
      // Fairness and rest carry into the next week.
      const stats = summarize(cfg, res.sol);
      extraOff = [];
      cleanStaff.forEach((s, e) => {
        carryNights[e] += stats.nights[s.id];
        carryWeekends[e] += stats.weekends[s.id];
        if (res.status === "OK" && res.sol.assign[e][DAYS - 1][3]) {
          extraOff.push({ id: s.id, day: 0, block: 0 }, { id: s.id, day: 0, block: 1 }, { id: s.id, day: 0, block: 2 });
        }
      });
    }
    setResults(out);
    } catch (err) {
      setGenError(["The engine hit an unexpected error: " + String(err) + ". If this keeps happening, use Reset app data on the Staff tab and re-enter your roster."]);
      setResults(null);
    }
  }

  function logAll() {
    if (!results) return;
    const good = results.filter((w) => w.result.status === "OK");
    setLog((l) => {
      let next = [...l];
      for (const w of good) {
        if (w.result.status !== "OK") continue;
        const stats = summarize(w.cfg, w.result.sol);
        const names: Record<string, string> = {};
        for (const s of w.cfg.staff) names[s.id] = s.name || "";
        next = next.filter((x) => x.weekStart !== w.weekStart);
        next.push({ weekStart: w.weekStart, hours: stats.hours, names, savedAt: new Date().toISOString() });
      }
      return next.sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
    });
    setSaveNote(`${good.length} week${good.length === 1 ? "" : "s"} saved to the hours ledger.`);
  }

  function deleteWeek(ws: string) { setLog((l) => l.filter((w) => w.weekStart !== ws)); }

  const colorIndex = useMemo(() => {
    const m: Record<string, number> = {};
    staff.forEach((s, i) => (m[s.id] = i));
    return m;
  }, [staff]);
  const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

  const periodReqs = [...adminReqs].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="wrap">
      <div className="masthead">
        <div>
          <p className="eyebrow">Operations · Coverage Engine</p>
          <h1>Schedule Automator</h1>
        </div>
        <div className="meta">
          <span className="big">{mode === "week" ? weekLabel(weekStart) : monthPick}</span>
          <br />
          two on the clock, around the clock · nights always 8p to 8a · {APP_VERSION}
        </div>
      </div>
      <div className="tabs">
        <button className={tab === "build" ? "on" : ""} onClick={() => setTab("build")}>Build schedule</button>
        <button className={tab === "staff" ? "on" : ""} onClick={() => setTab("staff")}>Staff</button>
        <button className={tab === "ledger" ? "on" : ""} onClick={() => setTab("ledger")}>Hours ledger{log.length ? ` (${log.length})` : ""}</button>
      </div>
      <div className="hairline" />

      {tab === "staff" && (
        <StaffView staff={staff} colorIndex={colorIndex} log={log}
          onUpdate={updateStaff} onRemove={removeStaff} onAdd={addStaff} />
      )}

      {tab === "ledger" && <LedgerView log={log} staff={staff} colorIndex={colorIndex} onDelete={deleteWeek} />}

      {tab === "build" && (
      <div className="layout">
        <div>
          <div className="panel">
            <h2>Period</h2>
            <div className="pivot" style={{ marginBottom: 12 }}>
              <button className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>One week</button>
              <button className={mode === "month" ? "on" : ""} onClick={() => setMode("month")}>Whole month</button>
            </div>
            {mode === "week" ? (
              <div className="field"><label>Week starts</label>
                <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} /></div>
            ) : (
              <div className="field"><label>Month</label>
                <input type="month" value={monthPick} onChange={(e) => setMonthPick(e.target.value)} /></div>
            )}
          </div>

          <div className="panel">
            <h2>Time Off Requests</h2>
            {periodReqs.length === 0 && <p className="covnote">None yet. Add a person, the date, and what they need off.</p>}
            {periodReqs.map((r) => (
              <div className="reqblock" key={r.key}>
                <div className="reqgrid">
                  <select value={r.id} onChange={(e) => updateAdminReq(r.key, { id: e.target.value })}>
                    {staff.map((s, k) => <option key={k} value={s.id}>{s.id}</option>)}
                  </select>
                  <input type="date" value={r.date} onChange={(e) => updateAdminReq(r.key, { date: e.target.value })} />
                  <select value={r.kind} onChange={(e) => updateAdminReq(r.key, { kind: e.target.value as AdminRequest["kind"] })}>
                    <option value="all">all day</option>
                    <option value="day">day shift</option>
                    <option value="night">night shift</option>
                    <option value="custom">custom hours</option>
                  </select>
                  <button className="rowdrop" onClick={() => removeAdminReq(r.key)}>×</button>
                </div>
                {r.kind === "custom" && (
                  <div className="reqtimes">
                    <input type="time" value={r.from} onChange={(e) => updateAdminReq(r.key, { from: e.target.value })} />
                    <span>to</span>
                    <input type="time" value={r.to} onChange={(e) => updateAdminReq(r.key, { to: e.target.value })} />
                  </div>
                )}
              </div>
            ))}
            <button className="addrow" onClick={addAdminReq}>+ Add time off</button>
          </div>

          <button className="generate" onClick={generate}>
            {mode === "week" ? "Generate schedule" : "Generate the whole month"}
          </button>
        </div>

        <div className="result">
          {!results && genError.length === 0 && (
            <div className="panel"><div className="empty">
              Pick the period, load staff requests, then generate.<br />
              Staffing, splits, and extra people are decided by the engine from everyone&apos;s hours.
            </div></div>
          )}

          {genError.length > 0 && (
            <div>
              <div className="sealbar"><span className="dot warn" /><span className="label">Stopped: a week could not be scheduled</span></div>
              {genError.map((p, i) => <div className="problem" key={i}>{p}</div>)}
            </div>
          )}

          {results && genError.length === 0 && (
            <div className="printarea">
              {results.some((w) => w.result.status === "OK" && w.result.compromises.length > 0) && (
                <div className="tradeoffs noprint">
                  <div className="tradeoffstitle">Built, with trade-offs the week forced:</div>
                  {results.flatMap((w) => (w.result.status === "OK" ? w.result.compromises : [])).map((c, i) => (
                    <div className="tradeoff" key={i}>{c}</div>
                  ))}
                </div>
              )}
              {results.map((w) => w.result.status === "OK" && (
                <WeekBand key={w.weekStart} weekStart={w.weekStart} cfg={w.cfg}
                  sol={w.result.sol} colorIndex={colorIndex} />
              ))}
              <PeriodHours results={results} colorIndex={colorIndex} />
              <div className="tools noprint">
                <button className="primarytool" onClick={logAll}>Save to hours ledger</button>
                <button onClick={() => window.print()}>Print schedule</button>
              </div>
              {saveNote && <div className="savednote noprint">{saveNote}</div>}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

const DAY_STARTS = ["8a", "12p", "4p"];
const DAY_ENDS = ["12p", "4p", "8p"];
function dayPresence(day: boolean[]): string | null {
  let first = -1, last = -1;
  for (let i = 0; i < 3; i++) if (day[i]) { if (first < 0) first = i; last = i; }
  if (first < 0) return null;
  return `${DAY_STARTS[first]}–${DAY_ENDS[last]}`;
}

function WeekBand({ weekStart, cfg, sol, colorIndex }: {
  weekStart: string; cfg: Config; sol: { assign: boolean[][][]; blocksOf: number[] }; colorIndex: Record<string, number>;
}) {
  // Shifts render positioned by their real times, packed into lanes:
  // a shift slides into the first lane free when it starts, so back-to-back
  // shifts (8a-4p then 4p-8p) stack in one lane, and only truly overlapping
  // shifts sit side by side. Same as the paper schedule.
  type Bar = { id: string; when: string; start: number; len: number; lane: number };
  const dayBars: Bar[][] = [];
  const nightBars: Bar[][] = [];
  for (let d = 0; d < DAYS; d++) {
    const items: Bar[] = [];
    for (let e = 0; e < cfg.staff.length; e++) {
      const pres = dayPresence(sol.assign[e][d]);
      if (!pres) continue;
      let first = 3, len = 0;
      for (let b = 0; b < 3; b++) if (sol.assign[e][d][b]) { first = Math.min(first, b); len++; }
      items.push({ id: cfg.staff[e].id, when: pres, start: first, len, lane: 0 });
    }
    items.sort((a, b) => a.start - b.start || b.len - a.len || a.id.localeCompare(b.id));
    const laneEnds: number[] = [];
    for (const it of items) {
      let lane = laneEnds.findIndex((end) => end <= it.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      it.lane = lane;
      laneEnds[lane] = it.start + it.len;
    }
    dayBars.push(items);

    const nItems: Bar[] = [];
    for (let e = 0; e < cfg.staff.length; e++) {
      if (sol.assign[e][d][3]) nItems.push({ id: cfg.staff[e].id, when: "8p–8a", start: 0, len: 3, lane: 0 });
    }
    nItems.sort((a, b) => a.id.localeCompare(b.id)).forEach((it, i) => (it.lane = i));
    nightBars.push(nItems);
  }

  const cell = (items: Bar[], tall: boolean) => {
    const lanes = Math.max(1, ...items.map((i) => i.lane + 1));
    return (
      <div className={"timecell" + (tall ? " tall" : " short")}>
        <span className="gridline g1" /><span className="gridline g2" />
        {items.map((it, k) => (
          <span className="bar" key={k} style={{
            background: colorFor(colorIndex[it.id] ?? 0),
            left: `calc(${(it.lane * 100) / lanes}% + 2px)`,
            width: `calc(${100 / lanes}% - 4px)`,
            top: `${(it.start * 100) / 3}%`,
            height: `calc(${(it.len * 100) / 3}% - 3px)`,
          }}>
            <span className="barid">{it.id}</span>
            <span className="bartime">{it.when}</span>
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="weekband">
      <div className="weekbandtitle">Week of {weekLabel(weekStart)}</div>
      <div className="band">
        <table>
          <thead><tr>
            <th className="slimcol"></th>
            {Array.from({ length: DAYS }).map((_, d) => {
              const iso = addDaysISO(weekStart, d);
              const dt = new Date(iso + "T00:00:00");
              return <th key={d}>{DOW[dt.getDay()]}<span className="date">{dt.getMonth() + 1}/{dt.getDate()}</span></th>;
            })}
          </tr></thead>
          <tbody>
            <tr><td className="rowhead slim axis"><span className="sidelabel">DAY</span>
                <span className="tick t0">8a</span><span className="tick t1">12p</span>
                <span className="tick t2">4p</span><span className="tick t3">8p</span></td>
              {dayBars.map((items, d) => <td className="slot timeslot" key={d}>{cell(items, true)}</td>)}</tr>
            <tr><td className="rowhead slim axis"><span className="sidelabel">NIGHT</span>
                <span className="tick t0">8p</span><span className="tick t1">12a</span>
                <span className="tick t2">4a</span><span className="tick t3">8a</span></td>
              {nightBars.map((items, d) => <td className="slot timeslot" key={d}>{cell(items, false)}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeriodHours({ results, colorIndex }: { results: WeekResult[]; colorIndex: Record<string, number> }) {
  const good = results.filter((w) => w.result.status === "OK");
  if (!good.length) return null;
  const staff = good[0].cfg.staff;
  const perWeek: Record<string, number>[] = good.map((w) =>
    w.result.status === "OK" ? summarize(w.cfg, w.result.sol).hours : {});
  return (
    <div className="ledger">
      <h3>{good.length > 1 ? "Hours · Whole Period" : "This Week's Hours"}</h3>
      <table>
        <thead><tr>
          <th>Staff</th>
          {good.map((w, i) => <th key={i}>Wk {i + 1}</th>)}
          <th>Total</th><th>Overtime</th>
        </tr></thead>
        <tbody>
          {staff.map((s, i) => {
            const weekly = perWeek.map((h) => h[s.id] || 0);
            const total = weekly.reduce((a, b) => a + b, 0);
            const ot = weekly.reduce((a, b) => a + Math.max(0, b - OT_THRESHOLD), 0);
            return (
              <tr key={i}>
                <td className="id"><span className="sw" style={{ background: colorFor(colorIndex[s.id] ?? 0) }} />{s.id}{s.name ? ` · ${s.name}` : ""}</td>
                {weekly.map((h, k) => <td key={k}>{h}</td>)}
                <td>{total} h</td>
                <td className={ot > 0 ? "ot" : ""}>{ot > 0 ? `${ot} h` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StaffView({
  staff, colorIndex, log, onUpdate, onRemove, onAdd,
}: {
  staff: RosterRow[]; colorIndex: Record<string, number>; log: LoggedWeek[];
  onUpdate: (i: number, p: Partial<RosterRow>) => void; onRemove: (i: number) => void; onAdd: () => void;
}) {
  const selectAll = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();
  const sorted = [...log].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  const sums = (id: string, n: number) => sorted.slice(0, n).reduce((a, w) => a + (w.hours[id] || 0), 0);
  const latest = (id: string) => (sorted[0]?.hours[id] ?? 0);

  return (
    <div>
      <div className="panel">
        <h2>Staff Settings</h2>
        <p className="covnote">Everything about each person lives here: who they are, what they can work, and their hours. Changes save on this device automatically.</p>
        <button className="rowdrop" style={{ marginTop: 6, fontSize: 11, letterSpacing: 1 }}
          onClick={() => { if (confirm("Reset all app data on this device? Roster, ledger, requests, and settings return to defaults.")) { localStorage.clear(); location.reload(); } }}>
          × Reset app data on this device
        </button>
      </div>

      {staff.map((row, i) => {
        const week = latest(row.id);
        const ot = Math.max(0, week - OT_THRESHOLD);
        return (
          <div className="panel staffcard" key={i}>
            <div className="staffhead">
              <span className="swatch big" style={{ background: colorFor(i) }} />
              <input className="staffid" type="text" value={row.id} maxLength={4} onFocus={selectAll}
                onChange={(e) => onUpdate(i, { id: e.target.value.toUpperCase() })} />
              <input className="staffname" type="text" value={row.name} placeholder="full name"
                onChange={(e) => onUpdate(i, { name: e.target.value })} />
              <button className="rowdrop" onClick={() => onRemove(i)}>× remove</button>
            </div>
            <div className="staffgrid">
              <div className="field"><label>Shift side</label>
                <select value={row.side} onChange={(e) => onUpdate(i, { side: e.target.value as Side })}>
                  <option value="day">day only</option><option value="night">night only</option><option value="any">either</option>
                </select></div>
              <div className="field"><label>Type</label>
                <select value={row.empType} onChange={(e) => onUpdate(i, { empType: e.target.value as "FT" | "PT" })}>
                  <option value="FT">full time</option><option value="PT">part time</option>
                </select></div>
              <div className="field"><label>Longest stretch</label>
                <select value={row.side === "night" ? "12" : row.stretch} disabled={row.side === "night"}
                  onChange={(e) => onUpdate(i, { stretch: e.target.value as "8" | "12" })}>
                  <option value="8">8 hours</option><option value="12">12 hours</option>
                </select></div>
              <div className="field"><label>Day lead (anchor)</label>
                <select value={row.anchor ? "yes" : "no"} disabled={row.side === "night"}
                  onChange={(e) => onUpdate(i, { anchor: e.target.value === "yes" })}>
                  <option value="no">no</option><option value="yes">yes</option>
                </select></div>
              <div className="field"><label>Primary</label>
                <select value={row.primary ? "yes" : "no"}
                  onChange={(e) => onUpdate(i, { primary: e.target.value === "yes" })}>
                  <option value="no">no</option><option value="yes">yes</option>
                </select></div>
              <div className="field"><label>Target h</label>
                <input type="text" inputMode="numeric" value={row.pref} onFocus={selectAll}
                  onChange={(e) => onUpdate(i, { pref: e.target.value.replace(/[^0-9]/g, "") })} /></div>
              <div className="field"><label>Min h</label>
                <input type="text" inputMode="numeric" value={row.min} onFocus={selectAll}
                  onChange={(e) => onUpdate(i, { min: e.target.value.replace(/[^0-9]/g, "") })} /></div>
              <div className="field"><label>Max h</label>
                <input type="text" inputMode="numeric" value={row.max} onFocus={selectAll}
                  onChange={(e) => onUpdate(i, { max: e.target.value.replace(/[^0-9]/g, "") })} /></div>
            </div>
            <div className="availwrap">
              <label className="availlabel">Weekly availability · tap to block a time</label>
              <table className="availgrid"><thead><tr><th></th>
                {DOW_SHORT.map((d, k) => <th key={k}>{d}</th>)}
              </tr></thead><tbody>
                {(row.side === "night" ? [3] : row.side === "day" ? [0, 1, 2] : [0, 1, 2, 3]).map((si) => (
                  <tr key={si}>
                    <td className="availslot">{AVAIL_SLOTS[si]}</td>
                    {Array.from({ length: 7 }).map((_, dw) => {
                      const on = row.avail?.[dw]?.[si] ?? true;
                      return (
                        <td key={dw}>
                          <button className={"availcell" + (on ? " on" : "")}
                            onClick={() => {
                              const next = (row.avail && row.avail.length === 7 ? row.avail : fullAvail()).map((day) => [...day]);
                              next[dw][si] = !next[dw][si];
                              onUpdate(i, { avail: next });
                            }}>{on ? "✓" : "×"}</button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody></table>
            </div>
            <div className="field"><label>Notes / requirements</label>
              <input type="text" value={row.notes} placeholder="anything to remember about this person"
                onChange={(e) => onUpdate(i, { notes: e.target.value })} /></div>
            <div className="staffhours">
              <span>Latest week: <b className={ot > 0 ? "ot" : ""}>{week} h{ot > 0 ? ` · ${ot} h OT` : ""}</b></span>
              <span>2 weeks: <b>{sums(row.id, 2)} h</b></span>
              <span>4 weeks: <b>{sums(row.id, 4)} h</b></span>
              <span>All logged: <b>{sums(row.id, sorted.length)} h</b></span>
            </div>
          </div>
        );
      })}
      <button className="addrow" onClick={onAdd}>+ Add staff member</button>
    </div>
  );
}

function LedgerView({ log, staff, colorIndex, onDelete }: {
  log: LoggedWeek[]; staff: RosterRow[]; colorIndex: Record<string, number>; onDelete: (ws: string) => void;
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
    return <div className="panel"><div className="empty">No weeks saved yet. Generate a schedule, then save it to the ledger.</div></div>;
  }
  return (
    <div>
      <div className="panel">
        <h2>Running Totals · All Saved Weeks</h2>
        <table className="ledgertable">
          <thead><tr><th>Staff</th><th>Weeks</th><th>Total hours</th><th>Total overtime</th></tr></thead>
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
        <p className="covnote">Overtime counts hours above {OT_THRESHOLD} in a single week. Full per-person breakdowns live on the Staff tab.</p>
      </div>
      {log.map((w) => (
        <div className="panel" key={w.weekStart}>
          <div className="weekhead">
            <h2>Week of {weekLabel(w.weekStart)}</h2>
            <button className="rowdrop" onClick={() => onDelete(w.weekStart)}>× remove</button>
          </div>
          <table className="ledgertable">
            <thead><tr><th>Staff</th><th>Hours</th><th>Overtime</th></tr></thead>
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
