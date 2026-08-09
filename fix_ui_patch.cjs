const fs = require('fs');

let ui = fs.readFileSync('src/components/BacktestScreen.tsx', 'utf8');

// Fix 'setInitialCapital' not being used because I replaced it badly maybe?
// Let's check where setInitialCapital is defined and used.
// It's defined: const [initialCapital, setInitialCapital] = useState<string>('100000');
// And used in: onChange={(e) => setInitialCapital(e.target.value)}
// Wait, TS says setInitialCapital is declared but never read. Maybe the <input> replacement failed.
ui = ui.replace(
  '          <div className="flex flex-col gap-1 mb-3">',
  '        <div className="flex flex-col gap-1 mb-3">'
);

// Fix the undefined index in BacktestScreen.tsx:226
// This is the compositeSeries loop:
// if (!byTimestamp[c.timestamp]) byTimestamp[c.timestamp] = [];
// c.timestamp can be undefined.
ui = ui.replace(
  'if (!byTimestamp[c.timestamp]) byTimestamp[c.timestamp] = [];\n            byTimestamp[c.timestamp].push(ret);',
  'if (c.timestamp) {\n              if (!byTimestamp[c.timestamp]) byTimestamp[c.timestamp] = [];\n              byTimestamp[c.timestamp].push(ret);\n            }'
);

fs.writeFileSync('src/components/BacktestScreen.tsx', ui, 'utf8');
