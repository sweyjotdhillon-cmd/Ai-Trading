const fs = require('fs');

function updateSetup() {
  const file = './src/components/BotSetupScreen.tsx';
  let code = fs.readFileSync(file, 'utf8');

  // Add leverage state
  code = code.replace(
    /const \[investmentPerTrade, setInvestmentPerTrade\] \= useState\<number\>\(\(\) \=\> \{/,
    `const [leverage, setLeverage] = useState<number>(() => {
    try {
      const v = localStorage.getItem('chartlens_leverage');
      return v ? parseInt(v, 10) : 5; // Default 5x margin for intraday
    } catch { return 5; }
  });

  const [investmentPerTrade, setInvestmentPerTrade] = useState<number>(() => {`
  );

  // Apply to previewConfig
  code = code.replace(
    /previewConfig.investmentPerTrade = investmentPerTrade;/,
    `previewConfig.investmentPerTrade = investmentPerTrade;\n  previewConfig.leverage = leverage;`
  );

  // Ensure config generation uses leverage
  code = code.replace(
    /investmentPerTrade,\n      rrRatioChoice,/,
    `investmentPerTrade,\n      leverage,\n      rrRatioChoice,`
  );

  // Add leverage to storage effect
  code = code.replace(
    /localStorage.setItem\('chartlens_investment_per_trade', investmentPerTrade.toString\(\)\);/,
    `localStorage.setItem('chartlens_investment_per_trade', investmentPerTrade.toString());\n    localStorage.setItem('chartlens_leverage', leverage.toString());`
  );

  // Render leverage option next to investment per trade
  const newControl = `{/* Control 1 — Investment per trade (₹) & Leverage */}
      <div className="bg-gray-800 p-4 rounded-lg flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-300 text-sm md:text-base">INVESTMENT PER TRADE (₹)</h2>
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-xs font-bold">Leverage:</span>
            <div className="flex bg-gray-900 rounded overflow-hidden border border-gray-700">
              {[1, 2, 5].map(lev => (
                <button
                  key={lev}
                  onClick={() => setLeverage(lev)}
                  className={\`px-2 py-0.5 text-xs font-black transition-colors \${leverage === lev ? 'bg-amber-500 text-amber-950' : 'text-gray-400 hover:bg-gray-700'}\`}
                >
                  {lev}x
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-zinc-400 font-mono">₹</span>
          <input 
            type="number"
            min="500"
            max={Number(capitalInput) || 100000}
            value={investmentPerTrade === 0 ? '' : investmentPerTrade}
            onChange={(e) => {
              const val = e.target.value;
              setInvestmentPerTrade(val === '' ? 0 : Number(val));
            }}
            onBlur={() => {
              setInvestmentPerTrade(prev => Math.max(500, Math.min(prev, Number(capitalInput) || 100000)));
            }}
            className="flex-1 bg-gray-700 text-white border border-gray-600 rounded p-2 focus:outline-none focus:border-blue-500 font-mono"
          />
        </div>
        <p className="text-[10px] text-zinc-400 leading-normal mt-0.5">
          Effective Exposure: <span className="text-amber-400 font-bold font-mono">₹{(investmentPerTrade * leverage).toLocaleString('en-IN')}</span> (Buys ₹{(investmentPerTrade * leverage).toLocaleString('en-IN')} worth of stock considering {leverage}x broker margin)
        </p>
      </div>`;

  code = code.replace(
    /\{\/\* Control 1 — Investment per trade \(₹\) \*\/\}[\s\S]*?\<\/p\>\n      \<\/div\>/,
    newControl
  );
  
  // also replace dependencies of useMemo for errors
  code = code.replace(
    /investmentPerTrade, rrRatioChoice, useConfidenceThreshold, maxConcurrentTrades, onStart\]/g,
    `investmentPerTrade, rrRatioChoice, useConfidenceThreshold, maxConcurrentTrades, leverage, onStart]`
  );
  code = code.replace(
    /investmentPerTrade, rrRatioChoice, useConfidenceThreshold, maxConcurrentTrades\]/g,
    `investmentPerTrade, rrRatioChoice, useConfidenceThreshold, maxConcurrentTrades, leverage]`
  );

  fs.writeFileSync(file, code);
}
updateSetup();
