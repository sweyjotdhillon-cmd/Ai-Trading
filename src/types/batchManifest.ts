export interface BatchManifestEntry {
  // REQUIRED
  imageFilename: string;          // matches a file the user uploads, e.g. "btc_001.png"

  // OPTIONAL
  imageData?: string;             // Base64 embedded image (removes need for 2-step upload)
  stock?: string;                 // e.g. "Bitcoin"
  graphTimeframe?: string;        // e.g. "5 minutes" — must match existing timeframes[]
  investmentDuration?: string;    // e.g. "5m" — must match existing durations[]
  investmentAmount?: number;      // default 100
  profitabilityPercent?: number;  // default 85
  expectedOutcome?: 'WIN' | 'LOSS' | 'UNKNOWN';   // for backtest accuracy scoring
  notes?: string;                 // freeform user note
  techniqueOverrides?: string[];  // override the global techniquesList for this entry
}

export interface BatchManifest {
  version: '1.0';
  createdAt: string;              // ISO
  entries: BatchManifestEntry[];
}

export function validateBatchManifest(json: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Manifest is not a valid JSON object.'] };
  }
  if (json.version !== '1.0') {
    errors.push('Manifest version must be "1.0".');
  }
  if (!Array.isArray(json.entries)) {
    return { valid: false, errors: [...errors, 'Manifest missing "entries" array.'] };
  }
  json.entries.forEach((entry: any, i: number) => {
    const loc = `Entry #${i + 1} (${entry.imageFilename || 'unknown file'})`;
    if (!entry.imageFilename) errors.push(`${loc}: missing "imageFilename".`);
  });

  return { valid: errors.length === 0, errors };
}
