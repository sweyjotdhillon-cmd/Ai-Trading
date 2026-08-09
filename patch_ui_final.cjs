const fs = require('fs');

let ui = fs.readFileSync('src/components/BacktestScreen.tsx', 'utf8');

// I need to add the input field since my previous attempt to add it failed to find the block.
// I will insert it right before Exit Strategy Controls
ui = ui.replace(
  '{/* Exit Strategy Controls */}',
  `<div className="flex flex-col gap-1.5 mt-1">
          <label className="text-xs uppercase font-black text-zinc-400 tracking-widest font-mono">
            Initial / Deployment Capital (₹)
          </label>
          <input
            type="number"
            step="1000"
            min="1000"
            value={initialCapital}
            onChange={(e) => setInitialCapital(e.target.value)}
            disabled={isRunning}
            className="bg-zinc-800 text-white border border-zinc-700 rounded-lg p-2.5 text-sm font-mono focus:outline-none focus:border-[#D9B382]/50"
          />
        </div>

        {/* Exit Strategy Controls */}`
);

fs.writeFileSync('src/components/BacktestScreen.tsx', ui, 'utf8');
