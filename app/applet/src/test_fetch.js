import "node-fetch";

async function test() {
  const proxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent("https://query1.finance.yahoo.com/v8/finance/chart/ADANIENT.NS?interval=1d&range=5d&includePrePost=false");
  const res = await fetch(proxyUrl);
  const json = await res.json();
  const timestamps = json.chart.result[0].timestamp;
  console.log("Timestamps:", timestamps);
  
  if (timestamps) {
     for (let ts of timestamps) {
        console.log(new Date((ts * 1000) + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10));
     }
  }
}
test();
