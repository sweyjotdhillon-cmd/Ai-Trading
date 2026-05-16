import re

with open("src/components/LiveAnalysis.tsx", "r") as f:
    content = f.read()

search = """          // if (pipActive && typeof result !== 'undefined' && result) {
          //   const pipDir = result.direction === 'UP' ? 'CALL' : result.direction === 'DOWN' ? 'PUT' : 'NO_TRADE';
          //   updatePip(pipDir, result.analysis.judge?.finalConfidence ?? 0);
          // }"""

replace = """          if (pipActive && typeof result !== 'undefined' && result) {
            const pipDir = result.direction === 'UP' ? 'CALL' : result.direction === 'DOWN' ? 'PUT' : 'NO_TRADE';
            updatePip(pipDir, result.analysis.judge?.finalConfidence ?? 0);
          }"""

new_content = content.replace(search, replace)

if new_content == content:
    print("Replace failed. Content not found.")
else:
    with open("src/components/LiveAnalysis.tsx", "w") as f:
        f.write(new_content)
    print("Replace succeeded.")
