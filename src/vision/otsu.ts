export function otsuThreshold(gray: Uint8Array): number {
  const histogram = new Int32Array(256);
  const len = gray.length;
  for (let i = 0; i < len; i++) {
    histogram[gray[i]]++;
  }

  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVar = 0;
  let threshold = 0;

  for (let i = 0; i < 256; i++) {
    wB += histogram[i];
    if (wB === 0) continue;
    wF = len - wB;
    if (wF === 0) break;

    sumB += i * histogram[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const varianceBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varianceBetween > maxVar) {
      maxVar = varianceBetween;
      threshold = i;
    }
  }

  return threshold;
}

export function binarize(gray: Uint8Array, threshold: number): Uint8Array {
  const len = gray.length;
  const bin = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bin[i] = gray[i] > threshold ? 1 : 0;
  }
  return bin;
}
