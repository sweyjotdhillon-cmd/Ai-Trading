---
name: technique-signal-evaluator
description: >
  Core reasoning protocol for Bull, Bear, and Judge agents when evaluating
  trading techniques against a chart. Use this skill whenever agents are
  processing a user-uploaded technique list to produce a CALL/PUT/NO_TRADE
  signal. Governs batching, relevance filtering, silent tallying, and
  final verdict rendering. Must be followed for every analysis run.
---

# Technique Signal Evaluator — Agent Protocol

## Purpose

This skill defines **how** the Bull, Bear, and Judge agents process any
technique list — regardless of what the techniques are named or what category
they belong to. Technique names and definitions come entirely from the user's
uploaded file. This skill only governs the *reasoning process*.

---

## The Three Agent Roles

### 🟢 Bull Agent
Actively looks for reasons each technique supports a **CALL (UP)** signal.
If a technique is ambiguous, Bull interprets the stronger bullish case.
Bull does NOT fabricate signals — if there is genuinely no bullish reading,
Bull marks the technique as NEUTRAL or skips it.

### 🔴 Bear Agent
Actively looks for reasons each technique supports a **PUT (DOWN)** signal.
Mirror of Bull. Bear does NOT force bearish readings where none exist.

### ⚖️ Judge Agent
Receives the tallies from Bull and Bear after all batches complete.
Judge applies the final verdict logic (see Phase 4). Judge also flags
anomalies like excessive skips, signal drift, or tight splits.

---

## Core Evaluation Protocol

### Phase 1 — Intake

1. Receive the technique list from the user's uploaded JSON file.
2. Count total techniques: `T_total`.
3. If `T_total < 10`, immediately return `NO_TRADE` with reason:
   *"Insufficient technique count. Minimum 10 required for a valid signal."*
4. Shuffle or accept techniques in the order provided — do not reorder
   by preference or familiarity.
5. Initialize the **Silent Tally**:
   ```
   bullScore      = 0
   bearScore      = 0
   processed      = 0   ← techniques that gave a signal (not skipped)
   skipped        = 0   ← techniques deemed irrelevant to this chart
   batchNum       = 0
   driftFlag      = false
   ```

---

### Phase 2 — Batch Processing (Groups of 5)

Process techniques in sequential batches of exactly 5.
After each batch, update the silent tally — **do not output interim results**.
Continue batching until `processed >= 10`.

#### For Each Technique Inside a Batch:

**Step A — Relevance Check**

Ask: *"Is this technique applicable to the current chart context?"*

A technique is **irrelevant** (skip it) if:
- It requires data the chart does not show (e.g., volume technique on a
  chart with no volume bars).
- It is designed for a completely different timeframe than the chart shown
  (e.g., a weekly trend tool on a 1-minute chart).
- The chart does not have enough candles for this technique to compute
  (e.g., a 200-period moving average on a 30-candle chart).
- The market condition makes the technique mathematically undefined
  (e.g., a divergence tool when price is perfectly flat).

When skipping: `skipped += 1`. Move to the next technique immediately.
**Agents have full freehand to skip** — never force a signal from an
irrelevant technique.

> ⚠️ Skip Ratio Alarm: If `skipped / (processed + skipped) > 0.6` after
> any batch, the Judge must note: *"High skip rate — chart may lack clarity
> for this technique set."* This does NOT stop the process, but lowers
> final confidence.

---

**Step B — Direction Determination**

If the technique IS relevant, determine its signal using this universal
decision tree:

```
1. What is the technique measuring?
   → Trend / Momentum     → Does it confirm continuation or reversal?
   → Oscillator           → Is it overbought, oversold, or crossing?
   → Pattern              → Is the pattern bullish or bearish?
   → Boundary / Level     → Is price breaking above or rejecting below?
   → Volatility           → Is it expanding (momentum) or contracting (caution)?
   → Composite / Hybrid   → Weight sub-components, take the net direction.

2. Given the chart, what does the technique currently say?
   → Clear UP signal      → Bull scores this technique
   → Clear DOWN signal    → Bear scores this technique
   → Neutral / Conflicted → Neither scores; mark as NEUTRAL (not a skip)
```

> NEUTRAL is different from SKIP. A skipped technique was irrelevant.
> A NEUTRAL technique was relevant but gave no clear directional edge.
> NEUTRALs do NOT increment `processed`.

---

**Step C — Weight Assignment**

Not all techniques carry equal weight. Apply this generic weight scale:

| Signal Clarity                          | Weight Added to Winner |
|-----------------------------------------|------------------------|
| Technique gives an extremely clear,     |                        |
| unambiguous signal                      | +2.0                   |
| Technique gives a moderate signal with  |                        |
| some conflicting sub-components         | +1.0                   |
| Technique gives a weak lean but is      |                        |
| directionally notable                   | +0.5                   |

Update tally:
- If signal is UP:   `bullScore += weight`,  `processed += 1`
- If signal is DOWN: `bearScore += weight`,  `processed += 1`
- If NEUTRAL:        no score change,        `processed` unchanged

---

**Step D — Batch Drift Detection** *(Silent)*

After completing each batch, internally check:

```
if batchNum >= 2:
  earlyLeader  = winner of first batch
  currentLead  = current leading score (bull vs bear)
  if earlyLeader != currentLead:
    driftFlag = true
```

Drift means later techniques are reversing the early signal.
This is noted silently and used by Judge in Phase 4 to reduce confidence.

---

**Step E — Continue or Stop**

```
if processed >= 10:
  → Proceed to Phase 3 (do not stop mid-batch; finish the current batch)
else:
  → Load next batch of 5 and repeat Phase 2
```

If all techniques are exhausted and `processed < 10` (due to heavy skipping):
→ Return `NO_TRADE`:
  *"Too many techniques were irrelevant to this chart. Fewer than 10
  valid signals could be extracted. No trade recommended."*

---

### Phase 3 — Tally Summary *(Internal, Not Shown to User)*

Once `processed >= 10`, compute:

```
margin        = |bullScore - bearScore|
totalScore    = bullScore + bearScore
rawLeader     = "BULL" if bullScore > bearScore else "BEAR"
skipRatio     = skipped / (processed + skipped)
```

Pass all values to Judge for Phase 4.

---

### Phase 4 — Judge Verdict

**Hard Blocks — Force NO_TRADE if any apply:**
- `processed < 10`
- `totalScore < 7.0` — not enough scoring techniques fired
- `margin < 3.0`     — split is too close, market is ambiguous
- `skipRatio > 0.6`  — chart is too unclear for this technique set

**Confidence Penalties — Reduce confidence score:**
- `driftFlag == true`            → confidence × 0.80
- `skipRatio between 0.4–0.6`   → confidence × 0.90
- Majority of weights were 0.5  → confidence × 0.85

**Base Confidence Formula:**
```
confidence = (margin / totalScore) × 100
```
Apply any penalties multiplicatively.

**Final Output:**

```
Signal:     CALL  /  PUT  /  NO_TRADE
Confidence: [0–100]%
Bull Score: X.X  |  Bear Score: X.X
Margin:     X.X
Techniques: [processed] evaluated, [skipped] skipped
Drift:      YES / NO
Verdict:    One sentence explanation from Judge.
```

---

## Quick Reference — Agent Decision Card

```
┌──────────────────────────────────────────────────────┐
│  TECHNIQUE RECEIVED                                   │
│       ↓                                              │
│  Relevant to chart?  ──NO──→  SKIP  (free, no score) │
│       ↓ YES                                          │
│  Clear direction?    ──NO──→  NEUTRAL (no score)     │
│       ↓ YES                                          │
│  How strong?                                         │
│    Strong  → +2.0 to winner                          │
│    Moderate → +1.0 to winner                         │
│    Weak    → +0.5 to winner                          │
│       ↓                                              │
│  Update silent tally. Continue batch.                │
│       ↓                                              │
│  processed >= 10?  ──NO──→  Next batch of 5          │
│       ↓ YES                                          │
│  Judge evaluates tally → CALL / PUT / NO_TRADE       │
└──────────────────────────────────────────────────────┘
```

---

## Edge Cases & Guard Rails

| Situation | Action |
|---|---|
| Only 10 techniques uploaded, 4 skipped | `processed = 6 < 10` → NO_TRADE |
| 20 techniques, strong consistent signal | Stop after first batch where `processed >= 10` |
| Bull and Bear score exactly equal | NO_TRADE (margin = 0) |
| All 10 processed techniques give CALL | `confidence = 100%`, signal = CALL |
| Technique list has duplicates | Treat each as independent evaluation; do not deduplicate |
| Technique is completely unknown to agents | Attempt good-faith interpretation using name/description; if truly uninterpretable, skip |

---

## Design Principles

1. **The technique file is the source of truth.** Agents must not substitute,
   ignore, or reweight techniques based on personal preference.

2. **Skipping is a feature, not a failure.** A skipped technique means the
   agent was honest about chart context, not lazy.

3. **Silence is discipline.** No interim verdicts, no "looks like a CALL so
   far" commentary. The tally runs completely silently until Phase 4.

4. **10 is the minimum, not the target.** Agents should process all relevant
   techniques, not stop exactly at 10. Stop only when the current batch ends
   after `processed` first crosses 10.

5. **Margin beats score.** A strong, lopsided split of 8 vs 2 is more
   trustworthy than a high-score but close split of 12 vs 10.
