import React, { memo, useCallback } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { legal } from '../config/legal';
import { useTheme } from '../theme';

/**
 * Opens an external URL, and says so when it cannot.
 *
 * A silent no-op on a legal link is worse than an error: the user believes they
 * have been shown terms they never saw.
 */
export async function openExternal(url: string, label: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error('unsupported');
    await Linking.openURL(url);
  } catch {
    Alert.alert(`Could not open ${label}`, url);
  }
}

export interface LegalLinksProps {
  /** Adds the support link. Off on the paywall, which needs only the two. */
  includeSupport?: boolean;
  align?: 'left' | 'center';
}

/**
 * Privacy policy and terms of use, linked from inside the binary.
 *
 * Guideline 3.1.2 requires both to be reachable from the subscription purchase
 * screen. They are rendered wherever a subscription is shown or managed.
 */
export const LegalLinks = memo(function LegalLinks({
  includeSupport = false,
  align = 'left',
}: LegalLinksProps): React.ReactElement {
  const { colors, spacing } = useTheme();

  const open = useCallback((url: string, label: string) => {
    void openExternal(url, label);
  }, []);

  const items: Array<{ label: string; url: string }> = [];
  if (legal.privacyPolicyUrl) {
    items.push({ label: 'Privacy Policy', url: legal.privacyPolicyUrl });
  }
  items.push({ label: 'Terms of Use', url: legal.termsOfUseUrl });
  if (includeSupport && legal.supportUrl) {
    items.push({ label: 'Support', url: legal.supportUrl });
  }

  return (
    <View
      style={[
        styles.row,
        { gap: spacing.lg, justifyContent: align === 'center' ? 'center' : 'flex-start' },
      ]}
    >
      {items.map((item) => (
        <Pressable
          key={item.label}
          onPress={() => open(item.url, item.label)}
          accessibilityRole="link"
          accessibilityHint={`Opens ${item.label.toLowerCase()} in your browser`}
          hitSlop={8}
        >
          <Text
            variant="caption"
            style={{ color: colors.accent, textDecorationLine: 'underline' }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});
