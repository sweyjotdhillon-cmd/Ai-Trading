import fs from 'fs';

const urls = [
  'https://query1.finance.yahoo.com/v8/finance/chart/ITC.NS?interval=5m&range=60d&includePrePost=false',
  'https://query1.finance.yahoo.com/v8/finance/chart/POWERGRID.NS?interval=5m&range=60d&includePrePost=false',
  'https://query1.finance.yahoo.com/v8/finance/chart/LTF.NS?interval=5m&range=60d&includePrePost=false',
  'https://query1.finance.yahoo.com/v8/finance/chart/M%26MFIN.NS?interval=5m&range=60d&includePrePost=false',
  'https://query1.finance.yahoo.com/v8/finance/chart/PETRONET.NS?interval=5m&range=60d&includePrePost=false',
  'https://query1.finance.yahoo.com/v8/finance/chart/NATIONALUM.NS?interval=5m&range=60d&includePrePost=false',
  'https://query1.finance.yahoo.com/v8/finance/chart/IEX.NS?interval=5m&range=60d&includePrePost=false',
  'https://query1.finance.yahoo.com/v8/finance/chart/CESC.NS?interval=5m&range=60d&includePrePost=false',
  'https://query1.finance.yahoo.com/v8/finance/chart/FEDERALBNK.NS?interval=5m&range=60d&includePrePost=false'
];

async function download() {
  for (const url of urls) {
    try {
      const parsedUrl = new URL(url);
      const symbolMatches = parsedUrl.pathname.match(/\/chart\/([A-Za-z0-9%&.]+)/);
      let symbol = symbolMatches && symbolMatches[1] ? decodeURIComponent(symbolMatches[1]) : 'unknown';
      symbol = symbol.toLowerCase();
      
      const fileName = `${symbol} historical data.json`.replace('&', 'and'); // Replacing & for file safety if needed, but let's stick to literal if possible or safe.
      
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      const data = await res.text();
      // let's exact filename from prompt or just use symbol name + suffix
      const exactFileName = `${symbol.toLowerCase()} historical data.json`;
      fs.writeFileSync(exactFileName, data);
      console.log(`Saved ${exactFileName}`);
    } catch (e) {
      console.error(`Failed on ${url}:`, e);
    }
  }
}

download();
