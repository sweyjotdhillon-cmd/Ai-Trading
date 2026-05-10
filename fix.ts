const fs = require('fs');
for (const file of ['src/components/LiveAnalysis.tsx', 'src/components/SystemSettingsModal.tsx']) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/text-opacity- /g, 'text-opacity-60 ');
  content = content.replace(/text-opacity-`/g, 'text-opacity-60`');
  content = content.replace(/text-opacity-\]/g, 'text-opacity-60]');
  content = content.replace(/text-opacity-}/g, 'text-opacity-60}');

  content = content.replace(/border-opacity- /g, 'border-opacity-10 ');
  content = content.replace(/border-opacity-`/g, 'border-opacity-10`');
  content = content.replace(/border-opacity-\]/g, 'border-opacity-10]');
  content = content.replace(/border-opacity-}/g, 'border-opacity-10}');

  content = content.replace(/bg-opacity- /g, 'bg-opacity-20 ');
  content = content.replace(/bg-opacity-`/g, 'bg-opacity-20`');
  content = content.replace(/bg-opacity-\]/g, 'bg-opacity-20]');
  content = content.replace(/bg-opacity-}/g, 'bg-opacity-20}');

  content = content.replace(/yellow- /g, 'yellow-400 ');
  content = content.replace(/yellow-`/g, 'yellow-400`');
  content = content.replace(/yellow-\]/g, 'yellow-400]');
  content = content.replace(/yellow-}/g, 'yellow-400}');

  content = content.replace(/border-\[#D9B382\]\//g, 'border-[#D9B382] border-opacity-20');

  fs.writeFileSync(file, content);
}
console.log('Fixed missing opacities');
