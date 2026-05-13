import { HSVBand } from './colorSpace';

export interface CalibrationPayload {
  version: "1";
  bull: HSVBand;
  bear: HSVBand;
}

const STORAGE_KEY = 'determinist.hsv.v1';

const DEFAULT_BULL: HSVBand = { hCenter: 135, hTolerance: 45, sMin: 0.35, vMin: 0.30 };
const DEFAULT_BEAR: HSVBand = { hCenter: 5,   hTolerance: 35, sMin: 0.35, vMin: 0.30 };

let activeCalibration: CalibrationPayload | null = null;

function detectPrivateModeFallback(): boolean {
  try {
    const testKey = '__test_priv_mode__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return false;
  } catch {
    return true; // Likely Safari private mode / no storage
  }
}

export function saveCalibration(bullBand: HSVBand, bearBand: HSVBand) {
  const payload: CalibrationPayload = {
    version: "1",
    bull: bullBand,
    bear: bearBand
  };
  activeCalibration = payload;
  if (!detectPrivateModeFallback()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch(e) {
      console.warn("Could not save calibration to localStorage", e);
    }
  }
}

export function loadCalibration(): CalibrationPayload | null {
  if (activeCalibration) return activeCalibration;
  if (!detectPrivateModeFallback()) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CalibrationPayload;
        if (parsed.version === "1") {
          activeCalibration = parsed;
          return parsed;
        }
      }
    } catch(e) {
      console.warn("Could not load calibration from localStorage", e);
    }
  }
  return null;
}

export function clearCalibration() {
  activeCalibration = null;
  if (!detectPrivateModeFallback()) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("Could not remove calibration from localStorage", e);
    }
  }
}

export function isCalibrated(): boolean {
  return true; // Auto-calibrated with default bands
}

export function getBullishHSVBands(): HSVBand {
  const cal = loadCalibration();
  return cal ? cal.bull : DEFAULT_BULL;
}

export function getBearishHSVBands(): HSVBand {
  const cal = loadCalibration();
  return cal ? cal.bear : DEFAULT_BEAR;
}

export function getCalibrationBands() {
  return { bull: getBullishHSVBands(), bear: getBearishHSVBands() };
}

export function setCalibrationBands(bull: HSVBand, bear: HSVBand) {
  activeCalibration = { version: "1", bull, bear };
}


