import fs from 'fs';
['src/quant/indicators.ts', 'src/quant/calculus.ts'].forEach(f => {
  if (fs.existsSync(f)) {
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\.fill\(NaN\)/g, '.fill(0)'));
    console.log('Fixed NaN in', f);
  }
});
const f3 = 'src/utils/singleAnalysis.ts';
if (fs.existsSync(f3)) {
  let content = fs.readFileSync(f3, 'utf8');
  content = content.replace(/Math\.random\(\)\.toString\(36\)\.substr\(2, 9\)/g, 'String(performance.now()).replace(".","")+String(++msgCounter)');
  if (!content.includes('let msgCounter = 0;')) {
    content = 'let msgCounter = 0;\n' + content;
  }
  fs.writeFileSync(f3, content);
}
