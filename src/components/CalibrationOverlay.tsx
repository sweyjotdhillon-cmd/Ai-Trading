import { useState, useEffect } from 'react';
import { View, Text, Pressable } from 'react-native';
import tw from 'twrnc';
import { saveCalibration } from '../vision/colorCalibration';
import { samplePatchHSV, calculateAdaptiveBand, hsvToRgb, HSVBand } from '../vision/colorSpace';
import { calibrateWorker } from '../utils/singleAnalysis';

interface Props {
  frame: ImageData;
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 'TAP_BULL' | 'TAP_BEAR' | 'CONFIRM';

/**
 * Overlay for user to tap and calibrate what "green" and "red" look like
 * on their specific chart platform.
 */
export function CalibrationOverlay({ frame, onComplete, onCancel }: Props) {
  const [step, setStep] = useState<Step>('TAP_BULL');
  const [bullBand, setBullBand] = useState<HSVBand | null>(null);
  const [bearBand, setBearBand] = useState<HSVBand | null>(null);
  const [bullRgb, setBullRgb] = useState<readonly [number, number, number] | null>(null);
  const [bearRgb, setBearRgb] = useState<readonly [number, number, number] | null>(null);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(frame, 0, 0);
      setFrameDataUrl(canvas.toDataURL('image/jpeg', 0.8));
    }
  }, [frame]);

  const handleImagePress = (e: any) => {
    if (step === 'CONFIRM') return;

    const { nativeEvent } = e;
    const layoutWidth = e.currentTarget?.clientWidth || frame.width;
    const layoutHeight = e.currentTarget?.clientHeight || frame.height;
    const offsetX = nativeEvent.locationX ?? nativeEvent.offsetX ?? 0;
    const offsetY = nativeEvent.locationY ?? nativeEvent.offsetY ?? 0;

    const scaleX = frame.width / layoutWidth;
    const scaleY = frame.height / layoutHeight;

    const srcX = Math.round(offsetX * scaleX);
    const srcY = Math.round(offsetY * scaleY);

    const patch = samplePatchHSV(frame, Math.max(0, Math.min(frame.width - 1, srcX)), Math.max(0, Math.min(frame.height - 1, srcY)), 5);
    const band = calculateAdaptiveBand(patch, 12);
    const rgb = hsvToRgb([band.hCenter, band.sMin + 0.2, band.vMin + 0.25]);

    if (step === 'TAP_BULL') {
      setBullBand(band);
      setBullRgb(rgb);
      setStep('TAP_BEAR');
    } else if (step === 'TAP_BEAR') {
      setBearBand(band);
      setBearRgb(rgb);
      setStep('CONFIRM');
    }
  };

  const handleConfirm = () => {
    if (bullBand && bearBand) {
      saveCalibration(bullBand, bearBand);
      calibrateWorker(bullBand, bearBand);
      onComplete();
    }
  };


  const handleRetake = () => {
    setStep('TAP_BULL');
    setBullBand(null);
    setBearBand(null);
    setBullRgb(null);
    setBearRgb(null);
  };

  return (
    <View style={tw`absolute inset-0 z-50 bg-black bg-opacity-90 items-center justify-center`} accessibilityRole="none">
      <View style={tw`flex-col items-center max-w-4xl w-full p-4`}>
        <Text style={tw`text-white font-black text-xl mb-2 text-center uppercase tracking-widest`}>
          Color Calibration
        </Text>

        <Text style={tw`text-[#D9B382] font-bold text-center mb-4`}>
          {step === 'TAP_BULL' ? 'Tap one GREEN candle' : 
           step === 'TAP_BEAR' ? 'Tap one RED candle' : 'Confirm calibration'}
        </Text>

        <View style={tw`flex-row gap-4 mb-4 justify-center`}>
           {bullRgb && (
             <View style={tw`flex-row items-center bg-gray-900 rounded p-2 border border-[#D9B382]/30`}>
                <Text style={tw`text-xs text-white mr-2`}>Bull:</Text>
                <View style={[tw`w-6 h-6 rounded border border-white/20`, { backgroundColor: `rgb(${bullRgb[0]},${bullRgb[1]},${bullRgb[2]})` }]} />
             </View>
           )}
           {bearRgb && (
             <View style={tw`flex-row items-center bg-gray-900 rounded p-2 border border-[#D9B382]/30`}>
                <Text style={tw`text-xs text-white mr-2`}>Bear:</Text>
                <View style={[tw`w-6 h-6 rounded border border-white/20`, { backgroundColor: `rgb(${bearRgb[0]},${bearRgb[1]},${bearRgb[2]})` }]} />
             </View>
           )}
        </View>

        <View style={[tw`relative bg-gray-900 border border-white/10 mx-auto rounded-lg overflow-hidden flex items-center justify-center`, { aspectRatio: frame.width / frame.height, width: '100%', maxWidth: '100%', maxHeight: '60vh' }]}>
          {frameDataUrl && (
            <Pressable 
              style={tw`w-full h-full`} 
              onPress={handleImagePress}
              accessibilityRole="button"
              accessibilityLabel="Chart frame for calibration"
            >
               <img 
                 src={frameDataUrl} 
                 alt="Calibration Frame" 
                 style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
               />
            </Pressable>
          )}
        </View>

        <View style={tw`flex-row gap-4 mt-6`}>
          {step === 'CONFIRM' && (
            <Pressable
              onPress={handleConfirm}
              style={tw`bg-[#D9B382] px-6 py-3 rounded-lg`}
              accessibilityRole="button"
              accessibilityLabel="Confirm"
            >
              <Text style={tw`text-[#1A1308] font-bold uppercase tracking-wider`}>Confirm calibration</Text>
            </Pressable>
          )}
          
          {(step === 'TAP_BEAR' || step === 'CONFIRM') && (
            <Pressable
              onPress={handleRetake}
              style={tw`bg-gray-800 px-6 py-3 rounded-lg border border-white/20`}
              accessibilityRole="button"
              accessibilityLabel="Retake"
            >
              <Text style={tw`text-white font-bold uppercase tracking-wider`}>Retake</Text>
            </Pressable>
          )}

          <Pressable
            onPress={onCancel}
            style={tw`bg-red-900/50 px-6 py-3 rounded-lg border border-red-500/50`}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={tw`text-red-200 font-bold uppercase tracking-wider`}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
