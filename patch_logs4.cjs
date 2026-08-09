const fs = require('fs');

let engine = fs.readFileSync('src/quant/backtestEngine.ts', 'utf8');

engine = engine.replace(/state\.sequenceId\+\+/g, '(state.sequenceId = (state.sequenceId ?? 0) + 1)');

fs.writeFileSync('src/quant/backtestEngine.ts', engine, 'utf8');
