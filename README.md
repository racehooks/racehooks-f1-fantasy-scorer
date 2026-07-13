# racehooks-f1-fantasy-scorer

**Live F1 Fantasy point scoring, powered by [RaceHooks](https://racehooks.io) — the motorsports analytics platform.**

Feed it the `events.race` payloads RaceHooks delivers during a Grand Prix and it produces
**running fantasy point totals per driver and per constructor, in real time** — using either
the official F1 Fantasy rules, an illustrative DFS variant, or your own custom rule set.

> RaceHooks is an independent service and is not affiliated with or endorsed by Formula One Management or the FIA. "Formula 1," "F1," and related marks are trademarks of Formula One Licensing BV.

```ts
import { FantasyScorer, OfficialF1ScoringRules } from "racehooks-f1-fantasy-scorer";

const scorer = new FantasyScorer({
  rules: OfficialF1ScoringRules,
  roster: ["VER", "NOR", "LEC", "HAM", "RUS"],
});

// Pipe RaceHooks events.race deliveries straight in as they arrive:
scorer.ingest(payload); // auto-finalises on session.complete

scorer.getScores();
// → { VER: 25, LEC: 25, NOR: 14, HAM: 14, RUS: -20 }
```

- **Zero dependencies.** Pure TypeScript, runs in Node and the browser.
- **Deterministic & event-sourced.** Every point is logged with a reason code.
- **Driver *and* constructor scoring** from one event stream.
- **Two rule sets out of the box** + a validator for your own.
- **Roster optimizer** for budget-constrained lineup suggestions.

---

## Install

```bash
npm install racehooks-f1-fantasy-scorer
# or
yarn add racehooks-f1-fantasy-scorer
```

---

## Why this exists

RaceHooks delivers structured F1 race events as webhooks. Its `events.race` feed fires exactly
the events a fantasy game needs — `overtake`, `positions.gained`/`positions.lost`,
`fastest.lap`, `pit.stop.complete`, `retirement`, `session.complete` — each carrying a full
driver identity block. This package is the missing piece between "I'm receiving `events.race`
webhooks" and "I have a live fantasy leaderboard."

---

## How it consumes `events.race`

Every `events.race` delivery shares one envelope and discriminates on `event`:

```ts
{
  feed: "events.race",
  sessionId: "2026-monaco_Race",
  lap: 18,
  utc: "2026-05-24T13:31:00Z",
  event: "overtake",
  data: {
    // full DriverRef nested under the relevant key — never a flat data.tla
    overtakingDriver: {
      driverId: "charles_leclerc", constructorId: "ferrari", number: "16",
      tla: "LEC", name: "Charles Leclerc", team: "Ferrari",
      prevPosition: 3, newPosition: 2
    }
  }
}
```

The scorer reads the nested `DriverRef` (`data.driver.tla`, `data.overtakingDriver.tla`, …)
and keys on `tla`. Hand it the whole feed — unknown / non-scoring events are ignored.

| `events.race` event | What it scores |
|---------------------|----------------|
| `session.start` | Sets the session kind (race / sprint / qualifying) |
| `session.complete` | Finalises classification; reads `data.winner` for P1 |
| `overtake` | Overtake points → `data.overtakingDriver` |
| `overtake.count` | Cumulative overtakes (credits only the new delta) |
| `positions.gained` / `positions.lost` | Grid → finish positions-gained scoring (uses `gridPosition` + `currentPosition`) |
| `lapseries.position.gained` / `.lost` | Tracks live position |
| `fastest.lap` | Fastest-lap bonus (DFS / custom rules only) |
| `retirement` | DNF penalty (race vs sprint aware) |
| `pit.stop.complete` | Constructor pit-stop points (keyed on `data.stationaryMs`) |
| `lead.change` / `top.three.update` | Tracks front-running positions |

You can also feed a RaceHooks **`LiveContext`** snapshot (the computed live board, with
lowercase `pos` and string `status`) to `processLiveUpdate(ctx)` — it mines each row for live
position and retirements (`status === "Retired"`).

---

## Quick start

```ts
import { FantasyScorer, OfficialF1ScoringRules } from "racehooks-f1-fantasy-scorer";

const scorer = new FantasyScorer({
  rules: OfficialF1ScoringRules,
  roster: ["VER", "NOR", "LEC", "HAM", "RUS"],
  // Optional: provide the starting grid so positions-gained scoring is exact.
  gridPositions: { VER: 1, NOR: 2, RUS: 3, LEC: 4, HAM: 7 },
  // Optional: nominate a turbo driver (2× their total).
  boost: { driver: "VER", multiplier: 2 },
});

// Subscribe to live updates.
const unsubscribe = scorer.on("scoreUpdate", (scores, event) => {
  console.log(`${event.driver} ${event.points > 0 ? "+" : ""}${event.points} (${event.reason})`);
  console.log(scores);
});

// In your RaceHooks webhook handler:
app.post("/webhook", (req) => {
  const payload = req.body;
  if (payload.feed === "events.race") scorer.ingest(payload); // auto-finalises on session.complete
});

// At any point:
scorer.getScores();            // { VER: 50, LEC: 25, ... }  (driver totals, boost applied)
scorer.getConstructorScores(); // per-constructor aggregation
scorer.getEventLog();          // ordered list of every scoring event
```

`ingest()` is a convenience router — hand it any `events.race` payload and it dispatches to the
right handler, and automatically calls `finalize()` when it sees `session.complete`. If you
prefer explicit control, call `processEvent`, `processLiveUpdate`, and `finalize` yourself.

---

## Driver of the Day

Driver of the Day is **not** an `events.race` event — it is an external, editorially-decided
input. Supply it explicitly rather than expecting it from the feed:

```ts
scorer.setDriverOfTheDay("LEC");           // idempotent; moves the bonus if re-called
// or at construction:
new FantasyScorer({ rules, roster, driverOfTheDay: "LEC" });
```

---

## API

### `new FantasyScorer(config)`

| Config field    | Type                         | Description |
|-----------------|------------------------------|-------------|
| `rules`         | `ScoringRules`               | The scoring system. Required. |
| `roster`        | `string[]`                   | Driver TLAs (or numbers) to score. Others are observed but not scored. Omit to score everyone. |
| `boost`         | `{ driver, multiplier }`     | Turbo/mega/captain multiplier applied to one driver's total. |
| `gridPositions` | `Record<string, number>`     | Starting positions by TLA, for positions-gained scoring. Falls back to event `gridPosition`, then first observed position. |
| `driverOfTheDay`| `string`                     | Driver of the Day TLA (external input). |

| Method | Description |
|--------|-------------|
| `processEvent(payload)`        | Score one `events.race` payload. |
| `processLiveUpdate(ctx)`       | Mine one `LiveContext` snapshot for positions & retirements. |
| `finalize(at?)`                | Score final classification (finish, positions gained/lost, beat-teammate, qualifying). Idempotent. |
| `ingest(payload)`              | Route any `events.race` payload; auto-finalises on `session.complete`. |
| `setDriverOfTheDay(tla)`       | Set the Driver of the Day bonus (external input). |
| `getScores()`                  | `{ TLA: points }` driver totals with boost applied. |
| `getScore(tla)`                | One driver's total. |
| `getConstructorScores()`       | Per-constructor aggregation: driver points + pit-stop points. |
| `getEventLog()`                | Ordered, immutable list of `ScoringLogEntry`. |
| `getSession()`                 | Current session kind (`race` \| `sprint` \| `qualifying`). |
| `on("scoreUpdate", cb)`        | Subscribe; returns an unsubscribe function. |
| `registerDriver(num, tla)`     | Map a racing number to a TLA. |

### Event log entries

```ts
interface ScoringLogEntry {
  scope: "driver" | "constructor"; // driver totals vs constructor pit points
  driver: string;                  // "VER" (driver) or "ferrari" (constructor slug)
  points: number;                  // 25  (may be negative)
  reason: string;                  // "P1_FINISH" | "OVERTAKE" | "DNF" | "PIT_STOP_TIME" | ...
  at: string;                      // ISO timestamp from the webhook
  session: "race" | "sprint" | "qualifying";
  detail?: Record<string, unknown>;
}
```

---

## Official F1 Fantasy scoring rules (2026)

`OfficialF1ScoringRules` encodes the official F1 Fantasy game. Values were sourced from the
[official rules](https://fantasy.formula1.com/en/game-rules) and corroborated against the
[Motor Sport Magazine 2025 guide](https://www.motorsportmagazine.com/articles/single-seaters/f1/f1-fantasy/f1-fantasy-leagues-tips-plus-full-updated-rules-and-scoring/),
[GridRival](https://support.gridrival.com/en/articles/4603741-f1-fantasy-points-scoring),
and community trackers.

### Driver — qualifying

| Grid position | Points |
|---------------|--------|
| P1 (pole)     | 10 |
| P2            | 9 |
| P3            | 8 |
| …             | … (−1 per place) |
| P10           | 1 |
| P11–P20       | 0 |
| Beat teammate (quali) | +2 |

### Driver — race

| Finish | Points |     | Finish | Points |
|--------|--------|-----|--------|--------|
| P1     | 25     |     | P6     | 8 |
| P2     | 18     |     | P7     | 6 |
| P3     | 15     |     | P8     | 4 |
| P4     | 12     |     | P9     | 2 |
| P5     | 10     |     | P10    | 1 |

| Bonus / penalty | Points |
|-----------------|--------|
| Position gained (per place, start → finish) | +1 |
| Position lost (per place)                   | −1 |
| Overtake (per legal on-track pass)          | +1 |
| Beat teammate (race)                        | +3 |
| Driver of the Day (external input)          | +10 |
| **DNF / not classified**                    | **−20** |

> The official game **no longer awards a fastest-lap bonus** (removed for 2025, still gone in
> 2026). `OfficialF1ScoringRules.fastestLapPoints` is therefore unset. The DFS rule set keeps it.
>
> Disqualification points are **not modelled** — the feed does not emit a disqualification
> signal, so there is nothing to score them from. Apply DSQ out of band if your league needs it.

### Driver — sprint

Sprint finishing points use the F1 sprint scale (**P1 = 8** down to **P8 = 1**). The **2026
sprint DNF penalty was reduced from −20 to −10** — that change is baked in.

### Constructor — aggregation + pit stops

A constructor's score is the **combined driver points of its two drivers** plus its
**pit-stop performance**. Pit points accrue to the constructor (keyed on `constructorId`),
never to a driver — read them via `getConstructorScores()`.

| Stationary time | Points |
|-----------------|--------|
| < 2.00s         | +20 |
| 2.00 – 2.19s    | +10 |
| 2.20 – 2.49s    | +5 |
| 2.50 – 2.99s    | +2 |
| > 3.00s         | 0 |

Plus **+5** to the team with the fastest stop of the race, and **+15** for a new pit-stop
world record (< 1.80s).

> For complete constructor totals, run the scorer **without** a `roster` so every driver's
> points are tracked. With a roster, `getConstructorScores()` aggregates only rostered drivers.

---

## DFS rules (illustrative)

`DFSScoringRules` models a generic Daily Fantasy Sports contest **shape** — not any specific
operator's rules:

- **Steeper finishing curve** (P1 = 45, every classified finisher scores).
- **Place differential is the headline stat** (+3 per position gained, −3 per position lost).
- **Fastest-lap bonus kept** (+5).
- **No DNF penalty** beyond positions naturally lost; no qualifying or constructor scoring.
- Default **1.5×** captain-style multiplier.

> The shipped DFS values are illustrative; clone the object and tune it to whatever contest
> you are scoring.

---

## Custom rules

A rule set is a plain, declarative object — no code. Define your own and validate it before use:

```ts
import { FantasyScorer, ScoringRulesValidator, type ScoringRules } from "racehooks-f1-fantasy-scorer";

const HouseRules: ScoringRules = {
  name: "My League",
  racePositionPoints: [0, 30, 22, 18, 14, 11, 9, 7, 5, 3, 2],
  qualifyingPositionPoints: [0, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  positionGainedPoints: 2,
  positionLostPoints: -1,
  overtakePoints: 1,
  fastestLapPoints: 5,
  raceDnfPoints: -15,
};

const result = ScoringRulesValidator.validate(HouseRules);
if (!result.valid) throw new Error(result.errors.join("\n"));
result.warnings.forEach((w) => console.warn(w));

const scorer = new FantasyScorer({ rules: HouseRules, roster: ["VER", "NOR"] });
```

The validator catches missing tables, positive "penalties", inverted point curves, and
inconsistent pit-stop bands. See [`src/rules/types.ts`](./src/rules/types.ts) for the full
`ScoringRules` shape.

---

## Roster optimizer

Given a pool of drivers with a price and a projected-points figure, build a budget-compliant
lineup that maximises projected points (value-greedy heuristic with a swap-improvement pass):

```ts
import { RosterOptimizer } from "racehooks-f1-fantasy-scorer";

const result = RosterOptimizer.optimize(
  [
    { tla: "VER", price: 30, projectedPoints: 95 },
    { tla: "NOR", price: 28, projectedPoints: 90 },
    { tla: "LEC", price: 24, projectedPoints: 78 },
    // ...the full driver pool
  ],
  { budget: 100, rosterSize: 5 }
);

result.drivers;                // 5 drivers, sorted by projected points
result.totalPrice;             // <= 100
result.totalProjectedPoints;   // sum of picks
result.remainingBudget;
```

It is a fast heuristic, not a guaranteed global optimum — ideal for live "suggested lineup"
features.

---

## Worked example

The [`fixtures/monaco-race-events.json`](./fixtures/monaco-race-events.json) fixture is a
representative 2026 Monaco GP sequence of real `events.race` payloads. Scored under
`OfficialF1ScoringRules` (with `setDriverOfTheDay("LEC")`):

**Drivers**

| Driver | Breakdown | Total |
|--------|-----------|-------|
| LEC | P2 (18) + gained 2 places (+2) + 2 overtakes (+2) + beat teammate (+3) + DotD (+10) | **35** |
| VER | P1 (25) | **25** |
| HAM | P5 (10) + gained 2 places (+2) + 2 overtakes (+2) | **14** |
| NOR | P3 (15) − lost 1 place (−1) | **14** |
| RUS | DNF | **−20** |

**Constructors** (`getConstructorScores()`)

| Constructor | Breakdown | Total |
|-------------|-----------|-------|
| Ferrari  | LEC (35) + HAM (14) | **49** |
| McLaren  | NOR (14) + sub-2s pit (20) + fastest pit (+5) | **39** |
| Red Bull | VER (25) + 2.15s pit (+10) | **35** |
| Mercedes | RUS (−20) | **−20** |

(See [`tests/scorer.test.ts`](./tests/scorer.test.ts) for the assertions.)

---

## Development

```bash
npm install
npm test          # jest
npm run typecheck # tsc --noEmit
npm run build     # emit dist/
```

---

## License

MIT © RaceHooks
