const fs = require('fs');

let content = fs.readFileSync('/app/src/App.tsx', 'utf8');

// Add RefreshCw import
content = content.replace("import { LogIn, Settings } from 'lucide-react';", "import { LogIn, Settings, RefreshCw } from 'lucide-react';");

// Replace the render method in TerminalErrorBoundary
const renderMethodRegex = /render\(\) \{\s*if \(this\.state\.hasError\) \{[\s\S]*?return this\.props\.children;\s*\}/;

const newRenderMethod = `render() {
    if (this.state.hasError) {
      return (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Unable to load terminal.</Text>
          <Text style={styles.errorHint}>Please try again.</Text>
          <Pressable
             style={({ pressed }) => [
                {
                  marginTop: 20,
                  backgroundColor: "#D9B382",
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  opacity: pressed ? 0.7 : 1
                }
             ]}
             onPress={() => this.setState({ hasError: false, errorMessage: null, errorStack: null })}
          >
             <RefreshCw color="#1A1308" size={16} />
             <Text style={{ color: "#1A1308", fontWeight: "bold", marginLeft: 8 }}>Retry</Text>
          </Pressable>
          {this.state.errorMessage ? <Text style={styles.errorDetails}>{this.state.errorMessage}</Text> : null}
          {this.state.errorStack ? <Text style={styles.errorDetails}>{this.state.errorStack.slice(0, 400)}</Text> : null}
        </View>
      );
    }

    return this.props.children;
  }`;

content = content.replace(renderMethodRegex, newRenderMethod);

fs.writeFileSync('/app/src/App.tsx', content);
