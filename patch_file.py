import re

with open("src/utils/singleAnalysis.ts", "r") as f:
    content = f.read()

search = """        const msgId2 = generateId();
        const payloadPromise2 = new Promise<any>((resolve, reject) => {
          messageResolvers.set(msgId2, { resolve, reject });

        });
        const payload2 = await payloadPromise2;"""

replace = """        const msgId2 = generateId();
        const payloadPromise2 = new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            messageResolvers.delete(msgId2);
            reject(new Error("Worker analysis timed out after 15 seconds."));
          }, 15000);

          messageResolvers.set(msgId2, {
            resolve: (val) => { clearTimeout(timeout); resolve(val); },
            reject: (err) => { clearTimeout(timeout); reject(err); }
          });

          try {
            w.postMessage({
              type: 'ANALYZE',
              msgId: msgId2,
              imageData: leftImgData,
              graphTimeframeMinutes: tfM,
              investmentDurationMinutes: durM,
              techniquesList: params.techniquesList
            });
          } catch (err) {
            clearTimeout(timeout);
            messageResolvers.delete(msgId2);
            reject(err);
          }
        });
        const payload2 = await payloadPromise2;"""

new_content = content.replace(search, replace)

if new_content == content:
    print("Replace failed. Content not found.")
else:
    with open("src/utils/singleAnalysis.ts", "w") as f:
        f.write(new_content)
    print("Replace succeeded.")
