import React from 'react';
import { View, Text, Pressable } from 'react-native';
import tw from 'twrnc';
import { motion } from 'motion/react';
import { ShieldAlert, AlertTriangle, Wrench, RefreshCw, Download } from 'lucide-react';
import { MasterAutopsySummary } from './BulkTestPanel';

interface BatchAutopsyReportProps {
  summary: MasterAutopsySummary | null;
  loading: boolean;
  onClear: () => void;
}

export function BatchAutopsyReport({ summary, loading, onClear }: BatchAutopsyReportProps) {
  const handleDownload = () => {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `loss-autopsy-summary-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <View style={tw`bg-red-500/10 border border-red-500/20 rounded-2xl p-6 items-center justify-center`}>
         <RefreshCw size={24} color="#EF4444" className="animate-spin mb-4" />
         <Text style={tw`text-red-400 font-black text-xs uppercase tracking-widest text-center`}>
           Generating Master Loss Autopsy...
         </Text>
         <Text style={tw`text-red-400/50 text-[10px] uppercase tracking-widest text-center mt-2`}>
           Analyzing failures across the batch via AI Risk Officer
         </Text>
      </View>
    );
  }

  if (!summary) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-6"
    >
      <View style={tw`bg-[#1A1212] border border-red-500/30 rounded-2xl overflow-hidden`}>
        {/* Header */}
        <View style={tw`bg-red-500/20 border-b border-red-500/30 p-4 flex-row items-center justify-between`}>
           <View style={tw`flex-row items-center`}>
             <ShieldAlert size={18} color="#EF4444" />
             <Text style={tw`text-red-400 font-black text-xs uppercase tracking-widest ml-2`}>
               Master Loss Autopsy
             </Text>
           </View>
           <View style={tw`flex-row items-center gap-6`}>
             <Pressable onPress={handleDownload} style={({pressed}) => [{opacity: pressed ? 0.5 : 1}, tw`flex-row items-center gap-1.5`]}>
               <Download size={12} color="#EF4444" style={tw`opacity-60`} />
               <Text style={tw`text-red-400/60 font-bold text-[10px] uppercase tracking-widest`}>Download JSON</Text>
             </Pressable>
             <Pressable onPress={onClear} style={({pressed}) => [{opacity: pressed ? 0.5 : 1}]}>
               <Text style={tw`text-red-400/60 font-bold text-[10px] uppercase tracking-widest`}>Dismiss</Text>
             </Pressable>
           </View>
        </View>

        {/* Content */}
        <View style={tw`p-6 gap-6`}>
           <View>
             <Text style={tw`text-white font-black text-xl mb-2 leading-tight`}>{summary.title}</Text>
             <Text style={tw`text-white/70 text-xs leading-relaxed`}>{summary.narrative}</Text>
           </View>

           <View style={tw`flex-row gap-4 flex-wrap`}>
             <View style={tw`flex-1 min-w-[200px] bg-black/40 border border-red-500/20 rounded-xl p-4`}>
                <View style={tw`flex-row items-center mb-2`}>
                  <AlertTriangle size={14} color="#EF4444" />
                  <Text style={tw`text-red-400 font-black text-[10px] uppercase tracking-widest ml-1.5`}>Core Weakness</Text>
                </View>
                <Text style={tw`text-white/80 text-xs leading-relaxed`}>{summary.coreWeakness}</Text>
             </View>

             <View style={tw`flex-1 min-w-[200px] bg-red-500/10 border border-red-500/40 rounded-xl p-4`}>
                <View style={tw`flex-row items-center mb-2`}>
                  <Wrench size={14} color="#EF4444" />
                  <Text style={tw`text-red-400 font-black text-[10px] uppercase tracking-widest ml-1.5`}>Recommended Action</Text>
                </View>
                <Text style={tw`text-white font-bold text-xs leading-relaxed`}>{summary.recommendedAction}</Text>
             </View>
           </View>
        </View>
      </View>
    </motion.div>
  );
}
