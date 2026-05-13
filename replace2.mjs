import fs from 'fs';

const lcgStr = `let _seed = 0xC0FFEE;
function pseudoRandom() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
};`;

function replaceInFile(file, regex, replacer) {
  if (fs.existsSync(file)) {
    let text = fs.readFileSync(file, 'utf8');
    text = text.replace(regex, replacer);
    if (file.includes('hero') || file.includes('mathEngine') || file.includes('LiveAnalysis')) {
       if (text.includes('pseudoRandom') && !text.includes('let _seed')) {
          text = lcgStr + '\n' + text;
       }
    }
    fs.writeFileSync(file, text);
  }
}

// 1. Math.random() -> pseudoRandom()
[
  'src/components/hero/Candle.tsx',
  'src/components/hero/Rings.tsx',
  'src/components/hero/Particles.tsx',
  'src/components/LiveAnalysis.tsx',
  'src/quant/mathEngine.ts'
].forEach(f => replaceInFile(f, /Math\.random\(\)/g, 'pseudoRandom()'));

// 2. Date.now() -> performance.now()
[
  'src/components/BulkTestPanel.tsx',
  'src/components/LiveAnalysis.tsx',
  'src/utils/storageUtils.ts',
  'src/utils/singleAnalysis.ts'
].forEach(f => replaceInFile(f, /Date\.now\(\)/g, 'performance.now()'));

