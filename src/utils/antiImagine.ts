export interface AntiImagineLog {
  timestamp: string;
  type: 'MOCK_DATA' | 'BYPASS' | 'ERROR' | 'FALLBACK';
  module: string;
  message: string;
  details?: any;
}

class AntiImagineLogger {
  private logs: AntiImagineLog[] = [];

  log(type: AntiImagineLog['type'], module: string, message: string, details?: any) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      type,
      module,
      message,
      details
    });
    this.persist();
  }

  getLogs() {
    return this.logs;
  }

  hasLogs() {
    return this.logs.length > 0;
  }

  clear() {
    this.logs = [];
    localStorage.removeItem('antiImagineLogs');
  }

  persist() {
    try {
      localStorage.setItem('antiImagineLogs', JSON.stringify(this.logs));
    } catch (e) {
      console.warn("Failed to persist anti-imagine logs");
    }
  }

  load() {
    try {
      const data = localStorage.getItem('antiImagineLogs');
      if (data) {
        this.logs = JSON.parse(data);
      }
    } catch (e) {
      console.warn("Failed to load anti-imagine logs");
    }
  }

  download() {
    if (!this.hasLogs()) return;
    
    const blob = new Blob([JSON.stringify({
      generatedAt: new Date().toISOString(),
      totalIssues: this.logs.length,
      logs: this.logs
    }, null, 2)], { type: 'application/json' });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anti-imagine.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const antiImagine = new AntiImagineLogger();
// Auto load on init
if (typeof window !== 'undefined') {
  antiImagine.load();
}
