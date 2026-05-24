export interface QuotaState {
  count: number;
  lastReset: string;
}

const DAILY_QUOTA_LIMIT = 50; // Daily default quota for active user

export const quotaTracker = {
  checkQuota(key: string = 'api_calls'): { allowed: boolean; remaining: number } {
    try {
      const today = new Date().toISOString().split('T')[0];
      const dataStr = localStorage.getItem(`quota_${key}`);
      let state: QuotaState = { count: 0, lastReset: today };

      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed && parsed.lastReset === today) {
            state = parsed;
          }
        } catch (e) {
          console.error("Error parsing quota state", e);
        }
      }

      const allowed = state.count < DAILY_QUOTA_LIMIT;
      return {
        allowed,
        remaining: Math.max(0, DAILY_QUOTA_LIMIT - state.count)
      };
    } catch (e) {
      console.error("Quota check failed", e);
      return { allowed: true, remaining: 1 };
    }
  },

  incrementQuota(key: string = 'api_calls'): number {
    try {
      const today = new Date().toISOString().split('T')[0];
      const dataStr = localStorage.getItem(`quota_${key}`);
      let state: QuotaState = { count: 0, lastReset: today };

      if (dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed && parsed.lastReset === today) {
            state = parsed;
          }
        } catch (e) {
          console.warn("Quota parse warning", e);
        }
      }

      state.count += 1;
      localStorage.setItem(`quota_${key}`, JSON.stringify(state));
      return state.count;
    } catch (e) {
      console.error("Quota increment failed", e);
      return 0;
    }
  },

  resetQuota(key: string = 'api_calls'): void {
    try {
      const today = new Date().toISOString().split('T')[0];
      const state: QuotaState = { count: 0, lastReset: today };
      localStorage.setItem(`quota_${key}`, JSON.stringify(state));
    } catch (e) {
      console.error("Quota reset failed", e);
    }
  }
};
