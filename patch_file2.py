import re

with open("src/utils/singleAnalysis.ts", "r") as f:
    content = f.read()

search = """           const originalClose = decision.evidence?.lastClose;
           const newClose = finalDecision.evidence.lastClose;

           if (originalClose !== undefined) {
             const actualDir = newClose > originalClose ? 'UP' : (newClose < originalClose ? 'DOWN' : 'NO_TRADE');"""

replace = """           const originalClose = decision.evidence?.lastClose;
           const newClose = finalDecision.evidence.lastClose;

           if (originalClose !== undefined) {
             const actualDir = originalClose > newClose ? 'UP' : (originalClose < newClose ? 'DOWN' : 'NO_TRADE');"""

new_content = content.replace(search, replace)

if new_content == content:
    print("Replace failed. Content not found.")
else:
    with open("src/utils/singleAnalysis.ts", "w") as f:
        f.write(new_content)
    print("Replace succeeded.")
