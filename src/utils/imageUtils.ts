export const compressImage = (base64Str: string, maxWidth: number, maxHeight: number, quality: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = (e) => reject(e);
  });
};

export const processImageFile = (file: File, maxWidth: number, maxHeight: number, quality: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      try {
        const compressed = await compressImage(base64, maxWidth, maxHeight, quality);
        resolve(compressed);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
};

export const dataURLtoBlob = (dataurl: string): Blob => {
  const arr = dataurl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
};

/**
 * Computes temporal delta between two frames using pixel-based momentum analysis.
 */
export function parseTimeframeToMinutes(timeframeStr: string): number {
  if (!timeframeStr) return 1;
  const str = timeframeStr.toLowerCase().trim();
  const numMatches = str.match(/\d+(\.\d+)?/);
  if (!numMatches) return 1;
  
  const num = parseFloat(numMatches[0]);
  if (str.includes('h')) return num * 60;
  if (str.includes('s')) return Math.max(0.1, num / 60);
  if (str.includes('d')) return num * 1440;
  
  return num; // default to minutes
}

export function autoDetectCandles(imageSource: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const width = img.width;
      const height = img.height;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(80); // Default fallback

      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height).data;

      const colIntensities = new Array(width).fill(0);
      
      // Calculate vertical intensity to find peaks (candles)
      for (let x = 0; x < width; x++) {
        let colSum = 0;
        for (let y = 0; y < height; y++) {
          const idx = (y * width + x) * 4;
          const r = imageData[idx];
          const g = imageData[idx+1];
          const b = imageData[idx+2];
          // Simple grayscale conversion
          colSum += (r + g + b) / 3;
        }
        colIntensities[x] = colSum / height;
      }

      // Smooth the column data
      const smoothed = new Array(width).fill(0);
      for (let x = 2; x < width - 2; x++) {
         smoothed[x] = (colIntensities[x-2] + colIntensities[x-1] + colIntensities[x] + colIntensities[x+1] + colIntensities[x+2]) / 5;
      }

      let peaks = 0;
      let trend = 0; 
      
      for (let x = 3; x < width - 2; x++) {
         const diff = smoothed[x] - smoothed[x-1];
         // A difference threshold to filter minor noise
         if (diff > 1.5) {
            trend = 1;
         } else if (diff < -1.5) {
            if (trend === 1) peaks++;
            trend = -1;
         }
      }

      console.log('[AutoDetectCandles] Parsed peaks:', peaks);
      
      if (peaks > 15 && peaks < 400) {
        resolve(peaks);
      } else {
        // Fallback to width estimation if algorithm flatlines or goes crazy
        resolve(Math.max(30, Math.floor(width / 12)));
      }
    };
    img.onerror = () => resolve(80);
    img.src = imageSource;
  });
}

export function cropRightByRatio(
  imageSource: string,
  cropRatio: number
): Promise<{ leftSliceBase64: string, rightSliceBase64: string, cropRatio: number, entryAnchorBase64: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Real bounds: 5% min (tiny crop for 1m on 30m chart) up to 40% max.
      // DO NOT floor at 0.35 — that defeats the whole point of duration ratio.
      cropRatio = Math.max(0.05, Math.min(0.40, cropRatio));

      const cutWidth = Math.floor(img.width * cropRatio);
      const leftWidth = img.width - cutWidth;
      const height = img.height;

      // Left slice = the "question" sent to debate API
      const canvasLeft = document.createElement('canvas');
      canvasLeft.width = leftWidth;
      canvasLeft.height = height;
      canvasLeft.getContext('2d')!
        .drawImage(img, 0, 0, leftWidth, height, 0, 0, leftWidth, height);

      // Right slice = the "answer key" — upscaled 2x for OCR clarity
      const upscale = 2;
      const canvasRight = document.createElement('canvas');
      canvasRight.width = Math.floor(cutWidth * upscale);
      canvasRight.height = Math.floor(height * upscale);
      const ctxRight = canvasRight.getContext('2d')!;
      ctxRight.imageSmoothingEnabled = true;
      ctxRight.imageSmoothingQuality = 'high';
      ctxRight.drawImage(img, leftWidth, 0, cutWidth, height,
                              0, 0, canvasRight.width, canvasRight.height);

      // NEW: Entry-anchor strip = last 8% of LEFT slice + full RIGHT slice.
      // This gives the grader the "entry candle" so it compares
      // (entry close) vs (final close of right slice) — the REAL trade math.
      const anchorLeftWidth = Math.floor(leftWidth * 0.08);
      const anchorTotalWidth = anchorLeftWidth + cutWidth;
      const canvasAnchor = document.createElement('canvas');
      canvasAnchor.width = Math.floor(anchorTotalWidth * upscale);
      canvasAnchor.height = Math.floor(height * upscale);
      const ctxAnchor = canvasAnchor.getContext('2d')!;
      ctxAnchor.imageSmoothingEnabled = true;
      ctxAnchor.imageSmoothingQuality = 'high';
      ctxAnchor.drawImage(
        img,
        leftWidth - anchorLeftWidth, 0, anchorTotalWidth, height,
        0, 0, canvasAnchor.width, canvasAnchor.height
      );

      console.log(`[CropRightByRatio] ratio=${cropRatio.toFixed(3)} ` +
                  `left=${canvasLeft.width}x${canvasLeft.height} ` +
                  `right=${canvasRight.width}x${canvasRight.height} ` +
                  `anchor=${canvasAnchor.width}x${canvasAnchor.height}`);

      resolve({
        leftSliceBase64:  canvasLeft.toDataURL('image/jpeg', 0.95),
        rightSliceBase64: canvasRight.toDataURL('image/jpeg', 0.95),
        entryAnchorBase64: canvasAnchor.toDataURL('image/jpeg', 0.95),
        cropRatio,
      });
    };
    img.onerror = reject;
    img.src = imageSource;
  });
}

export const createTemporalDelta = (currentBase64: string, cachedBase64: string): Promise<{
  momentum_concentration: 'UPPER' | 'LOWER' | 'NEUTRAL',
  price_velocity: number,
  momentum_magnitude: number,
  energy_ratio: number
}> => {
  return new Promise((resolve) => {
    const img1 = new Image();
    const img2 = new Image();
    let loaded = 0;

    const analyze = () => {
      loaded++;
      if (loaded < 2) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve({ momentum_concentration: 'NEUTRAL', price_velocity: 0, momentum_magnitude: 0, energy_ratio: 1 });

      canvas.width = 400;
      canvas.height = 400;

      ctx.drawImage(img1, 0, 0, 400, 400);
      const d1 = ctx.getImageData(0, 0, 400, 400).data;

      ctx.clearRect(0, 0, 400, 400);
      ctx.drawImage(img2, 0, 0, 400, 400);
      const d2 = ctx.getImageData(0, 0, 400, 400).data;

      let upperDiff = 0;
      let lowerDiff = 0;
      let totalDiff = 0;

      for (let i = 0; i < d1.length; i += 4) {
        const diff = Math.abs(d1[i] - d2[i]) + Math.abs(d1[i+1] - d2[i+1]) + Math.abs(d1[i+2] - d2[i+2]);
        const y = Math.floor((i / 4) / 400);
        
        if (y < 200) upperDiff += diff;
        else lowerDiff += diff;
        
        totalDiff += diff;
      }

      const energy_ratio = upperDiff / (lowerDiff + 1);
      const momentum_magnitude = totalDiff / (400 * 400 * 3);

      resolve({
        momentum_concentration: energy_ratio > 1.3 ? 'UPPER' : energy_ratio < 0.7 ? 'LOWER' : 'NEUTRAL',
        price_velocity: 0, 
        momentum_magnitude,
        energy_ratio
      });
    };

    img1.onload = analyze;
    img2.onload = analyze;
    img1.src = `data:image/jpeg;base64,${cachedBase64}`;
    img2.src = `data:image/jpeg;base64,${currentBase64}`;
  });
};


export const downscaleImage = async (dataUrl: string, maxDim: number = 800): Promise<string> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(dataUrl);
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (height / width) * maxDim;
          width = maxDim;
        } else {
          width = (width / height) * maxDim;
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'black'; // Fill background
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
      }
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(dataUrl); 
    img.src = dataUrl;
  });
};
