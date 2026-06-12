# @racehooks/fantasy-scorer

**Live F1 Fantasy point scoring from [RaceHooks](https://racehooks.io) webhook events.**

Feed it the `raceevent` and `timingdata` webhooks RaceHooks delivers during a
Grand Prix and it produces **running fantasy point totals per driver, in real
time** — using either the official F1 Fantasy rules, a DraftKings-style DFS
variant, or your own custom rule set.

> RaceHooks is an independent service and is not affiliated with or endorsed by Formula One Management or the FIA. "Formula 1," "F1," and related marks are trademarks of Formula One Licensing BV.

```ts
import { FantasyScorer, OfficialF1ScoringRules } from "@racehooks/fantasy-scorer";

const scorer = new FantasyScorer({
  rules: OfficialF1ScoringRules,
  roster: ["VER", "NOR", "LEC", "HAM", "RUS"],
});

// Pipe RaceHooks webhooks straight in as they arrive:
scorer.processEvent(raceEvent);        // raceevent payloads
scorer.processTimingUpdate(timingData); // timingdata payloads

scorer.getScores();
// → { VER: 35, NOR: 39, LEC: 32, HAM: 14, RUS: -20 }
```

- **Zero dependencies.** Pure TypeScript, runs in Node and the browser.
- **Deterministic & event-sourced.** Every point is logged with a reason code.
- **Three rule sets out of the box** + a validator for your own.
- **Roster optimizer** for budget-constrained lineup suggestions.

---

## Install

```bash
npm install @racehooks/fantasy-scorer
# or
yarn add @racehooks/fantasy-scorer
```

---

## Why this exists

RaceHooks turns the F1 live timing feed into clean webhooks. Its synthetic
`raceevent` feed fires exactly the events a fantasy game needs —
`overtake`, `fastest.lap`, `pit.stop.complete`, `retirement`, `driver_finished`
— and the `timingdata` feed carries live positions. This package is the missing
piece between "I'm receiving F1 webhooks" and "I have a live fantasy
leaderboard".

---

## Quick start

```ts
import { FantasyScorer, OfficialF1ScoringRules } from "@racehooks/fantasy-scorer";

const scorer = new FantasyScorer({
  rules: OfficialF1ScoringRules,
  roster: ["VER", "NOR", "LEC", "HAM", "RUS"],
  // Optional: provide the starting grid so positions-gained scoring is exact.
  gridPositions: { VER: 1, NOR: 2, RUS: 3, LEC: 4, HAM: 7 },
  // Optional: nominate a turbo / "DRS Boost" driver (2× their total).
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
  if (payload.feed === "raceevent") scorer.ingest(payload);     // auto-finalises on session.complete
  if (payload.feed === "timingdata") scorer.processTimingUpdate(payload);
});

// At any point:
scorer.getScores();    // { VER: 50, NOR: 39, ... }  (boost applied)
scorer.getEventLog();  // ordered list of every scoring event
```

`ingest()` is a convenience router — hand it any RaceHooks payload and it
dispatches to the right handler, and automatically calls `finalize()` when it
sees `session.complete`. If you prefer explicit control, call `processEvent`,
`processTimingUpdate`, and `finalize` yourself.

---

## API

### `new FantasyScorer(config)`

| Config field    | Type                                | Description |
|-----------------|-------------------------------------|-------------|
| `rules`         | `ScoringRules`                      | The scoring system. Required. |
| `roster`        | `string[]`                          | Driver TLAs to score. Others are ignored. Omit to score everyone. |
| `boost`         | `{ driver, multiplier }`            | Turbo/mega/captain multiplier applied to one driver's total. |
| `gridPositions` | `Record<string, number>`            | Starting positions by TLA, for positions-gained scoring. Inferred from the first observed position if omitted. |

| Method | Description |
|--------|-------------|
| `processEvent(payload)`        | Score one `raceevent` payload. |
| `processTimingUpdate(payload)` | Mine one `timingdata` payload for positions & retirements. |
| `finalize(at?)`                | Score final classification (finish points, positions gained/lost, qualifying). Call on `session.complete`. Idempotent. |
| `ingest(payload)`              | Route any payload automatically; auto-finalises on `session.complete`. |
| `getScores()`                  | `{ TLA: points }` with boost applied. |
| `getScore(tla)`                | One driver's total. |
| `getEventLog()`                | Ordered, immutable list of `ScoringLogEntry`. |
| `getSession()`                 | Current session kind (`race` \| `sprint` \| `qualifying`). |
| `on("scoreUpdate", cb)`        | Subscribe; returns an unsubscribe function. |
| `registerDriver(num, tla)`     | Map an F1 racing number to a TLA (so number-keyed `timingdata` lines resolve). |

### Event log entries

```ts
interface ScoringLogEntry {
  driver: string;     // "VER"
  points: number;     // 25  (may be negative)
  reason: string;     // "P1_FINISH" | "OVERTAKE" | "DNF" | "PIT_STOP_TIME" | ...
  at: string;         // ISO timestamp from the webhook
  session: "race" | "sprint" | "qualifying";
  detail?: Record<string, unknown>;
}
```

---

## Official F1 Fantasy scoring rules (2026)

`OfficialF1ScoringRules` encodes the official F1 Fantasy game. Values were
sourced from the [official rules](https://fantasy.formula1.com/en/game-rules)
and corroborated against the
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
| Failed to set a time / DSQ | −5 |

> Grid **penalties do not change** the qualifying points — they are based on the
> session result, not the final starting grid.

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
| Driver of the Day                           | +10 |
| Beat teammate (race)                        | +3 |
| **DNF / not classified**                    | **−20** |
| **Disqualified**                            | **−25** |

> The official game **no longer awards a fastest-lap bonus** (removed for 2025,
> still gone in 2026). `OfficialF1ScoringRules.fastestLapPoints` is therefore
> unset. The DFS rule set keeps it.

### Driver — sprint

Sprint finishing points use the F1 sprint scale (**P1 = 8** down to **P8 = 1**).
The **2026 sprint DNF penalty was reduced from −20 to −10** — that change is
baked in.

### Constructor — pit stops

| Stationary time | Points |
|-----------------|--------|
| < 2.00s         | +20 |
| 2.00 – 2.19s    | +10 |
| 2.20 – 2.49s    | +5 |
| 2.50 – 2.99s    | +2 |
| > 3.00s         | 0 |

Plus **+5** to the team with the fastest stop of the race, and **+15** for a new
pit-stop world record (< 1.80s). A constructor's total is its two drivers'
combined qualifying + race points plus this pit-stop score.

---

## DraftKings-style DFS rules

`DFSScoringRules` models a Daily Fantasy Sports contest:

- **Steeper finishing curve** (P1 = 45, every classified finisher scores).
- **Place differential is the headline stat** (+3 per position gained,
  −3 per position lost).
- **Fastest-lap bonus kept** (+5).
- **No DNF penalty** beyond positions naturally lost; no qualifying or
  constructor scoring.
- Default **1.5× captain** multiplier.

> The shipped DFS values illustrate the DFS *shape*; clone the object and tune
> it to a specific operator's published rules.

---

## Custom rules

A rule set is a plain, declarative object — no code. Define your own and validate
it before use:

```ts
import { FantasyScorer, ScoringRulesValidator, type ScoringRules } from "@racehooks/fantasy-scorer";

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

const scorer = new FantasyScorer({ rules: HouseRules, roster: [...] });
```

The validator catches missing tables, positive "penalties", inverted point
curves, and inconsistent pit-stop bands. See
[`src/rules/types.ts`](./src/rules/types.ts) for the full `ScoringRules` shape.

---

## Roster optimizer

Given a pool of drivers with a price and a projected-points figure, build a
budget-compliant lineup that maximises projected points (value-greedy heuristic
with a swap-improvement pass):

```ts
import { RosterOptimizer } from "@racehooks/fantasy-scorer";

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

It is a fast heuristic, not a guaranteed global optimum — ideal for live
"suggested lineup" features.

---

## Which RaceHooks events drive scoring?

| RaceHooks `raceevent` (or alias) | What it scores |
|----------------------------------|----------------|
| `driver_finished`                | Finish position points + positions gained/lost |
| `session.complete`               | Triggers final classification (`finalize()`) from last positions |
| `overtake`                       | Overtake points (handles cumulative `OvertakeSeries` counts) |
| `fastest.lap` / `fastest_lap`    | Fastest-lap bonus (DFS/custom rules only) |
| `pit.stop.complete` / `pit_stop_confirmed` | Constructor pit-stop time + fastest-stop / world-record bonuses |
| `retirement` / `dnf` / `driver_retired` | DNF penalty (race vs sprint aware) |
| `qualifying.segment.end` + final `timingdata` | Qualifying position points |
| `driver_of_the_day`              | Driver of the Day bonus |

The scorer accepts **both** RaceHooks' native dotted event names
(`pit.stop.complete`) and the shorter aliases used in some integrations
(`pit_stop_confirmed`), so either convention works.

---

## Worked example

The [`fixtures/monaco-race-events.json`](./fixtures/monaco-race-events.json)
fixture is a representative 2026 Monaco GP sequence. Scored under
`OfficialF1ScoringRules` it yields:

| Driver | Breakdown | Total |
|--------|-----------|-------|
| NOR | P3 (15) − lost 1 place (−1) + sub-2s pit (20) + fastest pit (+5) | **39** |
| VER | P1 (25) + pit 2.15s (10) | **35** |
| LEC | P2 (18) + gained 2 places (+2) + 2 overtakes (+2) + DotD (+10) | **32** |
| HAM | P5 (10) + gained 2 places (+2) + 2 overtakes (+2) | **14** |
| RUS | DNF | **−20** |

(See [`tests/scorer.test.ts`](./tests/scorer.test.ts) for the assertion.)

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
