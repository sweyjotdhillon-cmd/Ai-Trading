const fs = require('fs');
let content = fs.readFileSync('/app/src/components/LiveAnalysis.tsx', 'utf8');

content = content.replace("    // Stop screen share and PiP on reset\n", "    // Stop PiP on reset\n");

fs.writeFileSync('/app/src/components/LiveAnalysis.tsx', content);
