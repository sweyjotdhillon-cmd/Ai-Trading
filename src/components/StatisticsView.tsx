import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import tw from 'twrnc';
import { motion } from 'motion/react';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Percent, 
  Users, 
  Plus, 
  Filter, 
  FileText, 
  RotateCw, 
  CheckCircle, 
  XCircle, 
  Calendar,
  Layers,
  Cpu
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  BarChart, 
  Bar, 
  Cell, 
  PieChart, 
  Pie
} from 'recharts';

import { db, auth } from '../firebase';
import { collection, query, getDocs, orderBy, addDoc, limit } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../utils/firestoreErrorHandler';

interface SubUser {
  id: string;
  name: string;
}

export function StatisticsView() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const [subUsers, setSubUsers] = useState<SubUser[]>([
    { id: 'all', name: 'All Sub-accounts' },
    { id: 'default', name: 'Primary Account' },
    { id: 'bot-alpha', name: 'Bot Alpha' },
    { id: 'manual-strat', name: 'Tactical Manual' }
  ]);
  const [selectedSubUser, setSelectedSubUser] = useState<string>('all');
  const [newSubUserName, setNewSubUserName] = useState('');
  const [showAddSubUser, setShowAddSubUser] = useState(false);
  
  // Fetching stats from Firestore or fallback to session/local storage
  const fetchStats = async () => {
    setLoading(true);
    let items: any[] = [];
    
    try {
      // 1. Try to read from Firebase if connected
      const user = auth.currentUser;
      if (user) {
        const analysesRef = collection(db, 'tradeAnalyses');
        const q = query(analysesRef, orderBy('timestamp', 'desc'), limit(100));
        const snapshot = await getDocs(q);
        
        snapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() });
        });
      }
    } catch (err) {
      console.warn("Firestore statistics fetch skipped or failed, falling back:", err);
    }

    // 2. Fallback to Local/Session Storage if Firestore is empty or fails
    if (items.length === 0) {
      try {
        const localData = sessionStorage.getItem('stats_surface_data');
        if (localData) {
          const parsed = JSON.parse(localData);
          if (parsed && Array.isArray(parsed.stats)) {
            items = parsed.stats;
          }
        }
      } catch (e) {
        console.error("Local stats loading failed", e);
      }
    }

    // Standardize mapping to make sure they match expected formats
    const formatted = items.map((t: any) => {
      const isWin = t.result === 'WIN' || t.exactProfit > 0;
      return {
        ...t,
        isWin,
        dateFormatted: t.timestamp ? new Date(t.timestamp).toLocaleDateString() : (t.date || 'unknown'),
        profit: t.exactProfit ?? t.profitAmount ?? (isWin ? (t.profitPotential || 50) : -(t.investment || 100)),
        subUserId: t.subUserId || 'default',
        subUserName: t.subUserName || 'Primary Account',
        stock: t.stock || 'BTCUSDT',
        mistakeType: t.mistakeType || (t.followedRules === false ? 'unspecified mistake' : 'none')
      };
    }).sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

    setStats(formatted);
    setLoading(false);
  };

  // Add sub-user
  const handleAddSubUser = () => {
    if (!newSubUserName.trim()) return;
    const cleanName = newSubUserName.trim();
    const id = cleanName.toLowerCase().replace(/\s+/g, '-');
    
    // Avoid duplicates
    if (subUsers.some(u => u.id === id)) {
      alert("This sub-account already exists.");
      return;
    }

    const updated = [...subUsers, { id, name: cleanName }];
    setSubUsers(updated);
    localStorage.setItem('chartlens_sub_users', JSON.stringify(updated));
    setNewSubUserName('');
    setShowAddSubUser(false);
  };

  useEffect(() => {
    // Lead custom sub-users from local storage
    const saved = localStorage.getItem('chartlens_sub_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setSubUsers(parsed);
        }
      } catch (e) {
        console.warn("Storage sub-users parse warning", e);
      }
    }
    fetchStats();
  }, []);

  // Filtering based on Sub User
  const filteredStats = stats.filter(t => {
    if (selectedSubUser === 'all') return true;
    return t.subUserId === selectedSubUser;
  });

  // Performance calculations
  const totalTrades = filteredStats.length;
  const wins = filteredStats.filter(t => t.isWin).length;
  const losses = totalTrades - wins;
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
  
  const totalProfit = filteredStats.reduce((acc, t) => acc + (t.profit || 0), 0);
  const avgProfit = totalTrades > 0 ? (totalProfit / totalTrades) : 0;

  // Mistakes analysis data
  const mistakeCounts: Record<string, number> = {};
  filteredStats.forEach(t => {
    if (t.mistakeType && t.mistakeType !== 'none') {
      mistakeCounts[t.mistakeType] = (mistakeCounts[t.mistakeType] || 0) + 1;
    }
  });
  const mistakesData = Object.entries(mistakeCounts).map(([label, value]) => ({
    name: label,
    count: value
  }));

  // Preparing Recharts Cumulative Balance Data
  let runningBalance = 0;
  const equityCurveData = filteredStats.map((t, idx) => {
    runningBalance += t.profit;
    return {
      index: idx + 1,
      trade: `${t.stock} (${t.signal})`,
      profit: t.profit,
      balance: Number(runningBalance.toFixed(2)),
      date: t.dateFormatted
    };
  });

  // Formatting for Stock breakdown
  const stockProfits: Record<string, { wins: number; count: number; profit: number }> = {};
  filteredStats.forEach(t => {
    if (!stockProfits[t.stock]) {
      stockProfits[t.stock] = { wins: 0, count: 0, profit: 0 };
    }
    stockProfits[t.stock].count += 1;
    if (t.isWin) stockProfits[t.stock].wins += 1;
    stockProfits[t.stock].profit += t.profit;
  });

  const stockChartData = Object.entries(stockProfits).map(([stock, d]) => ({
    stock,
    profit: Number(d.profit.toFixed(2)),
    winRate: Math.round((d.wins / d.count) * 100)
  }));

  return (
    <ScrollView style={tw`flex-1 bg-[#0A0B0E] p-6`} contentContainerStyle={tw`pb-20`}>
      {/* Header and Sub-accounts Controller */}
      <View style={tw`flex-row flex-wrap items-center justify-between gap-4 mb-6 pb-6 border-b border-white border-opacity-5`}>
        <View style={tw`flex-col`}>
          <Text style={tw`text-2xl font-black text-white tracking-tight`}>PRO ANALYTICS</Text>
          <Text style={tw`text-[#8E9299] text-xs font-mono`}>STEREOSCOPIC AUDIT INDEX</Text>
        </View>

        <div className="flex flex-row items-center gap-2">
          {/* Sub User Custom Filters */}
          <div className="relative">
            <select
              value={selectedSubUser}
              onChange={(e) => setSelectedSubUser(e.target.value)}
              className="bg-[#14161C] text-sm text-white border border-white/10 rounded-xl px-4 py-2 pr-8 appearance-none focus:outline-none focus:border-[#D9B382]/50 cursor-pointer"
            >
              {subUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <div className="absolute top-1/2 right-3 -translate-y-1/2 pointer-events-none opacity-50">
              <Filter size={14} color="#FFF" />
            </div>
          </div>

          <Pressable
            style={tw`bg-[#14161C] border border-white/15 px-3 py-2 rounded-xl flex-row items-center justify-center`}
            onPress={() => setShowAddSubUser(!showAddSubUser)}
          >
            <Plus size={16} color="#D9B382" style={tw`mr-1`} />
            <Text style={tw`text-[#D9B382] font-bold text-xs`}>Add Account</Text>
          </Pressable>

          <Pressable
            style={tw`bg-black/40 border border-white/10 p-2 rounded-xl justify-center items-center`}
            onPress={fetchStats}
            disabled={loading}
          >
            <RotateCw size={14} color="#8E9299" className={loading ? 'animate-spin' : ''} />
          </Pressable>
        </div>
      </View>

      {/* Add Sub-account Panel */}
      {showAddSubUser && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#14161C] border border-[#D9B382]/20 rounded-2xl p-4 mb-6"
        >
          <Text style={tw`text-xs font-black text-[#D9B382] uppercase mb-2 tracking-widest`}>CREATE NEW SUB-ACCOUNT</Text>
          <View style={tw`flex-row gap-3`}>
            <TextInput
              style={tw`flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-white text-sm`}
              placeholder="Enter sub-account/bot name..."
              placeholderTextColor="#8E9299"
              value={newSubUserName}
              onChangeText={setNewSubUserName}
            />
            <Pressable
              style={tw`bg-[#D9B382] px-4 py-2 rounded-xl justify-center items-center`}
              onPress={handleAddSubUser}
            >
              <Text style={tw`text-[#1A1308] font-bold text-sm`}>Create</Text>
            </Pressable>
          </View>
        </motion.div>
      )}

      {loading ? (
        <View style={tw`py-12 justify-center items-center`}>
          <ActivityIndicator size="large" color="#D9B382" />
          <Text style={tw`text-[#8E9299] text-xs font-mono mt-4`}>COMPU-CALCULATING METRICS...</Text>
        </View>
      ) : (
        <>
          {/* Key Metric Blocks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {/* Win Rate */}
            <div className="bg-[#14161C] border border-white/5 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between min-h-[110px]">
              <div className="absolute -right-2 -bottom-2 bg-[#D9B382]/5 p-6 rounded-full">
                <Percent size={44} color="#D9B382" />
              </div>
              <Text style={tw`text-[10px] font-bold text-[#8E9299] uppercase tracking-wider`}>Win Ratio</Text>
              <View style={tw`flex-row items-baseline`}>
                <Text style={tw`text-3xl font-black text-white`}>{winRate}%</Text>
                <Text style={tw`text-[10px] text-green-400 font-bold ml-2`}>{wins}W - {losses}L</Text>
              </View>
            </div>

            {/* Total Profit */}
            <div className="bg-[#14161C] border border-white/5 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between min-h-[110px]">
              <div className="absolute -right-2 -bottom-2 bg-[#D9B382]/5 p-6 rounded-full">
                <DollarSign size={44} color="#D9B382" />
              </div>
              <Text style={tw`text-[10px] font-bold text-[#8E9299] uppercase tracking-wider`}>Net Return</Text>
              <View style={tw`flex-row items-baseline`}>
                <Text style={[tw`text-3xl font-black`, totalProfit >= 0 ? tw`text-green-400` : tw`text-red-400`]}>
                  {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
                </Text>
              </View>
            </div>

            {/* Total Trades */}
            <div className="bg-[#14161C] border border-white/5 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between min-h-[110px]">
              <div className="absolute -right-2 -bottom-2 bg-[#D9B382]/5 p-6 rounded-full">
                <Layers size={44} color="#D9B382" />
              </div>
              <Text style={tw`text-[10px] font-bold text-[#8E9299] uppercase tracking-wider`}>Audit Count</Text>
              <View style={tw`flex-row items-baseline`}>
                <Text style={tw`text-3xl font-black text-white`}>{totalTrades}</Text>
                <Text style={tw`text-[10px] text-[#8E9299] ml-2`}>total analyses logged</Text>
              </View>
            </div>

            {/* Average Profit */}
            <div className="bg-[#14161C] border border-white/5 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between min-h-[110px]">
              <div className="absolute -right-2 -bottom-2 bg-[#D9B382]/5 p-6 rounded-full">
                <Cpu size={44} color="#D9B382" />
              </div>
              <Text style={tw`text-[10px] font-bold text-[#8E9299] uppercase tracking-wider`}>Expectancy / Trade</Text>
              <View style={tw`flex-row items-baseline`}>
                <Text style={[tw`text-3xl font-black`, avgProfit >= 0 ? tw`text-green-400` : tw`text-red-400`]}>
                  {avgProfit >= 0 ? '+' : ''}${avgProfit.toFixed(2)}
                </Text>
              </View>
            </div>
          </div>

          {/* Charts Row */}
          {totalTrades > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Cumulative Equity Curve Chart */}
              <div className="lg:col-span-2 bg-[#14161C] border border-white/5 rounded-[24px] p-6">
                <Text style={tw`text-sm font-bold text-white mb-4`}>Performance Curve (Cumulative Return)</Text>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <AreaChart data={equityCurveData}>
                      <defs>
                        <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#D9B382" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#D9B382" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="index" stroke="#5E6983" fontSize={10} tickLine={false} />
                      <YAxis stroke="#5E6983" fontSize={10} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#14161C', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff' }}
                        itemStyle={{ color: '#D9B382' }}
                      />
                      <Area type="monotone" dataKey="balance" name="Cumulative ($)" stroke="#D9B382" fillOpacity={1} fill="url(#colorBalance)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Stock Performance breakdown */}
              <div className="bg-[#14161C] border border-white/5 rounded-[24px] p-6">
                <Text style={tw`text-sm font-bold text-white mb-4`}>Win Ratio by Asset</Text>
                {stockChartData.length > 0 ? (
                  <div className="space-y-4">
                    {stockChartData.map((d, i) => (
                      <div key={i} className="flex-col">
                        <div className="flex flex-row justify-between items-center mb-1">
                          <Text style={tw`text-white text-xs font-bold font-mono`}>{d.stock}</Text>
                          <Text style={tw`text-[#D9B382] text-xs font-bold font-mono`}>{d.winRate}% wr</Text>
                        </div>
                        <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-[#D9B382] rounded-full" 
                            style={{ width: `${d.winRate}%`, opacity: 0.4 + (d.winRate / 160) }}
                          />
                        </div>
                        <div className="flex flex-row justify-between mt-0.5">
                          <Text style={tw`text-[9px] text-[#8E9299]`}>Subprofit</Text>
                          <Text style={[tw`text-[9px] font-bold`, d.profit >= 0 ? tw`text-green-400` : tw`text-red-400`]}>
                            {d.profit >= 0 ? '+' : ''}${d.profit}
                          </Text>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Text style={tw`text-[#8E9299] text-xs`}>No asset breakdown available</Text>
                )}
              </div>
            </div>
          ) : null}

          {/* Detailed Lists with Sub-user information */}
          <div className="bg-[#14161C] border border-white/5 rounded-[24px] p-6">
            <Text style={tw`text-base font-bold text-white mb-4`}>Historic Audit Log</Text>
            {filteredStats.length === 0 ? (
              <View style={tw`py-12 items-center justify-center`}>
                <FileText size={44} color="#2A2C35" style={tw`mb-4`} />
                <Text style={tw`text-[#8E9299] text-sm`}>No trades logged under this sub-account.</Text>
                <Text style={tw`text-[#8E9299] text-xs mt-1`}>Complete an analysis in the analyzer to build stats.</Text>
              </View>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-[10px] text-[#8E9299] uppercase font-mono">
                      <th className="pb-3 font-semibold">Time</th>
                      <th className="pb-3 font-semibold">Sub-user</th>
                      <th className="pb-3 font-semibold">Instrument</th>
                      <th className="pb-3 font-semibold">Direction</th>
                      <th className="pb-3 font-semibold">Grade</th>
                      <th className="pb-3 font-semibold text-right">Return ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-white">
                    {filteredStats.slice().reverse().map((t, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 flex flex-row items-center gap-1.5">
                          <Calendar size={12} color="#8E9299" />
                          <span className="font-mono">{t.dateFormatted}</span>
                        </td>
                        <td className="py-3">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-[#D9B382]/10 text-[#D9B382] font-semibold text-[10px] border border-[#D9B382]/15">
                            {t.subUserName}
                          </span>
                        </td>
                        <td className="py-3 font-bold font-mono">{t.stock}</td>
                        <td className="py-3">
                          <span className={`font-semibold ${t.signal === 'CALL' ? 'text-green-400' : (t.signal === 'PUT' ? 'text-red-400' : 'text-[#8E9299]')}`}>
                            {t.signal}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-row items-center gap-1.5">
                            {t.isWin ? <CheckCircle size={14} color="#22C55E" /> : <XCircle size={14} color="#EF4444" />}
                            <span className={t.isWin ? 'text-green-400' : 'text-red-400'}>{t.result || (t.isWin ? 'WIN' : 'LOSS')}</span>
                          </div>
                        </td>
                        <td className={`py-3 text-right font-mono font-bold ${t.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {t.profit >= 0 ? '+' : ''}${Number(t.profit).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </ScrollView>
  );
}
