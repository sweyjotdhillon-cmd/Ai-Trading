export function toISTMs(utcMs: number): number {
  return utcMs + 5.5 * 60 * 60 * 1000;
}

export function getISTDateString(utcMs: number): string {
  return new Date(toISTMs(utcMs)).toISOString().slice(0, 10);
}

export function todayIST(): string {
  return getISTDateString(Date.now());
}

export function isAfterMarketClose(nowMs?: number): boolean {
  const ist = new Date(toISTMs(nowMs ?? Date.now()));
  const hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  return hours > 15 || (hours === 15 && minutes >= 30);
}

export function getISTMinutes(nowMs?: number): number {
  const ist = new Date(toISTMs(nowMs ?? Date.now()));
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}
