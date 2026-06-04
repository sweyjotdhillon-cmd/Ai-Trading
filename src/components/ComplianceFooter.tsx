import React from 'react';
import { View, Text } from 'react-native';
import tw from 'twrnc';

export const ComplianceFooter: React.FC = () => {
  return (
    <View style={tw`w-full py-4 px-6 mt-8 border-t border-zinc-800/40 bg-[#070708]/30 items-center justify-center`}>
      <Text style={tw`font-mono text-[10px] text-zinc-500 text-center tracking-tight`}>
        Educational tool. Not SEBI-registered. No personalized advice. Past performance ≠ future results.
      </Text>
    </View>
  );
};
