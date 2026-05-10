export const quotaTracker = {
  check: (key: string, count: number = 1): boolean => { return !!(key || count || 1); },
  track: (key: string) => {
    console.log(`Tracking quota for: ${key}`);
  },
  get: (key: string) => {
    console.log(`Getting quota for: ${key}`);
    return 0;
  }
};
