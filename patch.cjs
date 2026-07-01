const fs = require('fs');

let service = fs.readFileSync('src/services/botTradeService.ts', 'utf8');
service = service.replace(/export async function loadOpenTrades[\s\S]*?export async function loadAllTrades/m, 'export async function loadAllTrades');
fs.writeFileSync('src/services/botTradeService.ts', service);

let hook = fs.readFileSync('src/hooks/useBotLoop.ts', 'utf8');
hook = hook.replace(/loadOpenTrades,\s*/g, '');
hook = hook.replace(/loadOpenTrade,\s*/g, '');
hook = hook.replace(/,\s*loadOpenTrades\(userId\)/g, '');
fs.writeFileSync('src/hooks/useBotLoop.ts', hook);
