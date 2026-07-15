# Schedule Automator

A coverage engine for a floor that always needs two staff on, around the clock. You enter your roster, each person's required weekly hours, and any time off requests. It builds a full week that holds every hard rule and balances the rest fairly. The solving runs in the browser in a fraction of a second, so there is no backend to host and nothing leaves the page.

## What it holds, without exception

1. Exactly two staff on every shift, day and night, all seven days.
2. Nobody works two shifts in one day.
3. No night shift into the next morning's day shift, so rest is real.
4. Time off requests are absolute. A held slot stays empty for that person.
5. Each person's weekly hours land inside their own minimum and maximum.

On top of that it balances preferred hours, spreads night shifts evenly, spreads weekend shifts evenly, and honors day or night leanings where it can. Before any schedule appears, it is checked against every hard rule. If your rules cannot all hold at once, you get the reason and the fix instead of a broken week.

## Run it on your machine first

You need Node 18 or newer.

```
npm install
npm run dev
```

Open http://localhost:3000. Edit the roster, add requests, and click Generate schedule. Print or save to PDF from the button under the result.

## Put it on Vercel

Two ways. The GitHub route is the one to keep, because every push redeploys itself.

**Route A, GitHub and the Vercel dashboard.**
1. Create a new repository and push this folder to it.
   ```
   git init
   git add .
   git commit -m "Schedule Automator"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/schedule-automator.git
   git push -u origin main
   ```
2. Go to vercel.com, click Add New, then Project, and import that repository.
3. Vercel detects Next.js on its own. Leave every setting at its default and click Deploy. You get a live link in about a minute.

**Route B, the Vercel command line.** Fastest for a one time push.
```
npm i -g vercel
vercel
```
Answer the prompts, then run `vercel --prod` to promote it to your live domain.

Nothing extra to configure. There are no environment variables and no database. The solver ships inside the page and runs on the viewer's device.

## Using the interface

**Week.** Pick the start date. The columns and weekend fairness follow it. The pivot toggle switches the whole system between 8 and 8 and the 9 and 9 your old PDF used.

**Roster.** Each row is one person. Pref is the target weekly hours. Min and Max are hard walls the schedule will never cross. Lean tells the engine whether someone belongs on days, nights, or either. Hours run in twelve hour shifts, so set hours in multiples of twelve. One shift is twelve hours, three shifts is thirty six.

**Time off requests.** Add a row, pick the person, the day, and whether they are out for the day shift, the night shift, or the whole day. The slot is held open for them.

**Generate.** The engine tries thousands of valid weeks in under a second and keeps the fairest one. The seal at the top confirms two on every shift. The ledger shows each person's hours against their target, plus nights and weekend load.

## Reading the result

Every person keeps one color across the whole week so the eye can follow them. Green hours in the ledger mean the person landed inside their min and max. The counts on the right let you see at a glance that nights and weekends are shared, not dumped on the same few people.

## Changing how it decides

The balance is set by four weights in `app/page.tsx`, inside the `generate` function.

```
weights: { hours: 100, night: 8, weekend: 6, lean: 4 }
```

Raise `hours` to push harder on hitting targets. Raise `night` or `weekend` to force a flatter spread. Raise `lean` to honor day and night preferences more strictly. Higher means the engine tries harder on that goal.

## Locking someone to a slot

The engine already supports forced placements, for a case like one senior who must open every Friday. Add them in the `generate` function:

```
locked: [{ id: "AT", day: 0, shift: "day" }],
```

Day zero is the week start. If you want this as a panel in the interface later, it is a small addition in the same style as the requests panel.

## How this relates to the Python engine

The first build used Google OR-Tools, the strongest solver class for this kind of problem. It is ideal for very large or very tight rosters, but it is a heavy native binary that fights with Vercel's limits. For twelve people the logic reimplemented here in TypeScript finds the same quality of schedule with none of the hosting friction, and it runs instantly in the browser. If your operation ever grows past what this handles comfortably, the OR-Tools engine is the upgrade path, run as a small API on a container host with this same interface in front of it.

## Project map

```
app/
  layout.tsx      fonts and shell
  page.tsx        the whole interface and state
  globals.css     the Elegancy tokens, paper and ink
lib/
  solver.ts       the constraint engine, framework free
  types.ts        the shared shapes
```

The solver has no dependency on React or Next. You can lift `lib/solver.ts` into any other project as is.
