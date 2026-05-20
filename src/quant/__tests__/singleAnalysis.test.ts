import { describe, it, expect } from 'vitest';



describe('Predict-First Test Mode: WIN/LOSS/NEUTRAL Matrix', () => {
  it('Prediction UP + Actual UP -> WIN', () => {
    const outcome = testGrade('UP', 'UP');
    expect(outcome).toBe('WIN');
  });

  it('Prediction UP + Actual DOWN -> LOSS', () => {
    const outcome = testGrade('UP', 'DOWN');
    expect(outcome).toBe('LOSS');
  });

  it('Prediction DOWN + Actual DOWN -> WIN', () => {
    const outcome = testGrade('DOWN', 'DOWN');
    expect(outcome).toBe('WIN');
  });

  it('Prediction DOWN + Actual UP -> LOSS', () => {
    const outcome = testGrade('DOWN', 'UP');
    expect(outcome).toBe('LOSS');
  });

  it('Prediction NO_TRADE -> NEUTRAL', () => {
    const outcome = testGrade('NO_TRADE', 'UP');
    expect(outcome).toBe('NEUTRAL');
  });

  it('Actual FLAT -> NEUTRAL', () => {
    const outcome = testGrade('UP', 'FLAT');
    expect(outcome).toBe('NEUTRAL');
  });
});

function testGrade(predicted: string, actual: string) {
    if (actual === 'FLAT' || predicted === 'NO_TRADE') {
        return 'NEUTRAL';
    } else if (predicted === 'UP') {
        return actual === 'UP' ? 'WIN' : 'LOSS';
    } else if (predicted === 'DOWN') {
        return actual === 'DOWN' ? 'WIN' : 'LOSS';
    }
    return 'NEUTRAL';
}
