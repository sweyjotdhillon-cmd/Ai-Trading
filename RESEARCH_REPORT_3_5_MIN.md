# Mathematical Quantitative Models for 3-5 Minute Binary Options

This document outlines six purely deterministic, mathematical models specifically adapted for the 3-5 minute binary options trading horizon. These models rely entirely on Open, High, Low, Close (OHLC) camera-extracted data and eschew subjective "allure" for strict statistical analysis.

## 1. Hurst Exponent (Local Mean Reversion)

The Hurst Exponent ($H$) quantifies the relative tendency of a price series either to regress strongly to the mean or to cluster in a direction.
In binary options, especially at the 3-5 minute horizon (where noise levels are extremely high), knowing if the market is trending or ranging is arguably more important than the signal itself.

### Formula
We use the Rescaled Range (R/S) method. Over a rolling window of size $N$:

1. Calculate logarithmic returns: $R_i = \ln(P_i / P_{i-1})$
2. Calculate the mean of returns: $m = \frac{1}{N} \sum R_i$
3. Mean-adjusted series: $Y_t = R_t - m$
4. Cumulative deviate series: $Z_t = \sum_{i=1}^t Y_i$
5. Range: $R = \max(Z_1, \ldots, Z_N) - \min(Z_1, \ldots, Z_N)$
6. Standard deviation of returns: $S = \sqrt{\frac{1}{N} \sum (R_i - m)^2}$
7. Hurst Exponent: $H = \frac{\log(R/S)}{\log(N)}$

### Thresholds & Horizon Application
*   **$H < 0.45$**: Market is strongly **mean-reverting**. Acts as a multiplier reducing momentum (`J1 *= 0.85`) and boosting boundary/reversal signals (`J3 *= 1.15`).
*   **$H \approx 0.5$**: Random walk (Brownian motion). Market is noisy. Neutral effect.
*   **$H > 0.55$**: Market is strongly **trending**. Acts as a multiplier boosting momentum (`J1 *= 1.15`) and reducing boundary/reversal signals (`J3 *= 0.85`).
*   **Window Size**: Lookback period $N$ is typically `30` or `32` candles for the local Hurst function calculation.

## 2. Z-Score Breakout Significance

The Z-Score measures how many standard deviations a current price is from its rolling mean. It helps filter out normal market noise from statistically significant structural breaks.

### Formula
$Z = \frac{P_{current} - \mu}{\sigma}$
where $\mu$ is the simple moving average (SMA) over lookback $L$, and $\sigma$ is the standard deviation over lookback $L$.

### Thresholds & Horizon Application
*   **Lookback ($L$)**: $L = 20$ or $21$ (standard for short horizons).
*   **$|Z| > 2.0$**: **Significant Breakout**. The price action has escaped the local noise band.
    *   If $Z > 2.0$, contributes $+1.5$ points directly to the bullish oscillator consensus (`bullJ2 += 1.5`).
    *   If $Z < -2.0$, contributes $+1.5$ points directly to the bearish oscillator consensus (`bearJ2 += 1.5`).
*   **$|Z| > 2.5$ (Total Range Significance)**: When extreme total candle range movements are detected, acts as a confidence modifier reducing overall confidence (`skepticMultiplier *= 0.6`).

## 3. EMA Higher-Order Derivatives

Momentum isn't just speed; it's acceleration. By analyzing the discrete differences (derivatives) of the Exponential Moving Average (EMA), we can spot momentum dying before price physically reverses.

### Formula
Let $E[n]$ be the EMA of price at candle $n$.
*   **Velocity (1st Derivative)**: $v[n] = E[n] - E[n-1]$
    *   Tells us the current direction and speed.
*   **Acceleration (2nd Derivative)**: $a[n] = v[n] - v[n-1]$
    *   Tells us if the speed is increasing or decreasing.
*   **Jerk (3rd Derivative)**: $j[n] = a[n] - a[n-1]$
    *   Tells us if the acceleration is changing. A sign flip in jerk is often the earliest mathematical warning of a trend exhaustion.

### Thresholds & Horizon Application
*   We calculate these on a fast EMA (e.g., period 9).
*   If velocity > 0 but acceleration < 0, a bullish trend is slowing down.

## 4. Micro-Momentum Score

A composite indicator that builds a directional conviction score based purely on the alignment of the Z-score and EMA derivatives.

### Formula & Logic
Score ranges from `-3` to `+3`. Start at 0.
1.  **Z-Score Component**: If $Z > 1.0$, Score $+1$. If $Z < -1.0$, Score $-1$.
2.  **Velocity Component**: If $v[n] > 0$, Score $+1$. If $v[n] < 0$, Score $-1$.
3.  **Acceleration Component**: If $a[n] > 0$, Score $+1$. If $a[n] < 0$, Score $-1$.

### Thresholds & Horizon Application
*   **Score = +3**: Strong CALL confluence. Momentum is fully aligned upwards.
*   **Score = -3**: Strong PUT confluence. Momentum is fully aligned downwards.
*   **Score = 0**: Conflicting signals (noise). Skip trade.

## 5. Volatility Regime Filter

Volatility expands and contracts. A strategy that works in high volatility will fail in low volatility, and vice-versa. We use an ATR (Average True Range) ratio to define the current regime.

### Formula
$Ratio_{ATR} = \frac{ATR_{current}}{ATR_{average\_over\_20\_candles}}$

### Thresholds & Horizon Application
*   **$Ratio_{ATR} > 1.8$**: **HIGH VOLATILITY**. The market is wild. Scales down overall confidence (`skepticMultiplier *= 0.7`).
*   **$Ratio_{ATR} < 0.6$**: **LOW VOLATILITY / COMPRESSION**. The market is coiling. A breakout is mathematically imminent. If combined with a Z-Score Breakout ($|Z| > 2.0$), it boosts overall confidence (`skepticMultiplier *= 1.2`).
*   Otherwise: **NORMAL**.

## 6. RSI Divergence Math

Divergence between price action and momentum oscillators (like RSI) is a powerful leading indicator of reversals. We mathematically define it by comparing the slopes between the last two localized swing highs/lows.

### Formula & Logic
Let $P_{H1}, P_{H2}$ be the last two swing highs in price (where $P_{H2}$ is more recent).
Let $R_{H1}, R_{H2}$ be the RSI values at those exact same candle indices.

*   **Bearish Divergence**: Price made a higher high ($P_{H2} > P_{H1}$) BUT RSI made a lower high ($R_{H2} < R_{H1}$).
    *   Return: `'BEARISH'` (Weight: +2.0 to bearJ3 in rule engine)
*   **Bullish Divergence**: Price made a lower low ($P_{L2} < P_{L1}$) BUT RSI made a higher low ($R_{L2} > R_{L1}$).
    *   Return: `'BULLISH'` (Weight: +2.0 to bullJ3 in rule engine)
*   Otherwise: `'NONE'`

## Integration: Scoring Weight Table (Rule Engine)

| Model | Bullish Condition (+ Points) | Bearish Condition (- Points) | Max Absolute Weight |
| :--- | :--- | :--- | :--- |
| **Micro-Momentum** | Score == +3 (+2 pts) | Score == -3 (-2 pts) | ±2.0 |
| **Z-Score Breakout** | $Z > 2.0$ (+1.5 pts) | $Z < -2.0$ (-1.5 pts) | ±1.5 |
| **RSI Divergence** | BULLISH Divergence (+2 pts) | BEARISH Divergence (-2 pts) | ±2.0 |

*Note: Total points modify `bullJ1` / `bearJ1` (momentum judge) or `bullJ2`/`bearJ2` depending on exact rule engine integration.*

## The "DO NOT TRADE" Checklist (Hard Blocks)

If any of these conditions are met, the engine must force `winner = 'NO_TRADE'` and drop confidence to 0%.

1.  **High Volatility + Mean Reverting**: $Ratio_{ATR} > 1.8$ AND $H < 0.45$. (Market is wildly whipping around with no trend. Unpredictable.)
2.  **Zero Volatility**: $ATR_{current} \approx 0$. (Market is dead. No liquidity.)
3.  **Complete Indecision**: Micro-Momentum Score = 0 AND $|Z| < 0.5$.

## Edge Cases and Failure Modes (3-5 Min Horizon)

*   **Hurst Calculation on Short Series**: The R/S calculation can be unstable if $N < 20$. We must ensure minimum data lengths.
*   **Flatlined RSI**: In extreme, persistent trends, RSI stays at 99 or 1 for many candles, causing false divergence signals. We must ensure swing points are actually "swings" (e.g., local max/min over a 3-candle window).
*   **Wick Noise**: A single massive wick can skew the ATR Ratio or Z-Score. Using median or capping max deviations could mitigate this, but for raw speed, we stick to the mathematical definitions and rely on the composite score to filter anomalies.
