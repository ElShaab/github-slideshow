import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '../theme';
import { FEEDBACK_MAX_LENGTH, feedbackError, type FeedbackDelivery } from '../state/feedback';
import { PrimaryButton, SecondaryButton } from './Buttons';
import { Text } from './Text';
import { TextField } from './TextField';

export interface FeedbackModalProps {
  visible: boolean;
  /** Called when the sheet closes, however it closed. */
  onClose: () => void;
  /** Files the message. Resolves with where it ended up. */
  onSubmit: (message: string) => Promise<FeedbackDelivery>;
}

/** What to tell someone, given where their message actually got to. */
const DELIVERY_NOTE: Record<FeedbackDelivery, string> = {
  sent: 'It has been sent, and we read every one.',
  'queued-offline': "It is saved on your phone and will send itself once you're back online.",
  'queued-no-account': 'It is saved on your phone and will send itself once you create your account.',
};

/**
 * The feedback sheet.
 *
 * Deliberately one screen and one field. Every rating prompt, category picker
 * or star row is another thing to get past before saying the thing, and the
 * app only wants the sentence.
 *
 * It never reports a failure, because there is nothing to fail: the message is
 * written to the device before anything is sent, so the only question is
 * whether it has left yet, and the confirmation says which.
 */
export function FeedbackModal({
  visible,
  onClose,
  onSubmit,
}: FeedbackModalProps): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<FeedbackDelivery | null>(null);

  const close = useCallback(() => {
    onClose();
    // Reset after the sheet is on its way out, so the text does not visibly
    // clear itself while the animation is still running.
    setMessage('');
    setError(null);
    setDelivery(null);
    setSending(false);
  }, [onClose]);

  const send = useCallback(() => {
    const problem = feedbackError(message);
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setSending(true);
    void onSubmit(message.trim())
      .then(setDelivery)
      // onSubmit keeps the message either way, so a rejection here is still a
      // message safely on the phone. Saying so beats a red error for something
      // the user cannot act on.
      .catch(() => setDelivery('queued-offline'))
      .finally(() => setSending(false));
  }, [message, onSubmit]);

  const remaining = FEEDBACK_MAX_LENGTH - message.trim().length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.backgroundElevated,
                borderColor: colors.glassBorder,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
              },
            ]}
          >
            <ScrollView
              contentContainerStyle={{ padding: spacing.xxl, paddingBottom: spacing.huge }}
              keyboardShouldPersistTaps="handled"
            >
              {delivery ? (
                <>
                  <Text variant="heading" accessibilityRole="header">
                    Thank you
                  </Text>
                  <Text color="muted" style={{ marginTop: spacing.md }}>
                    {DELIVERY_NOTE[delivery]}
                  </Text>
                  <PrimaryButton
                    label="Close"
                    onPress={close}
                    style={{ marginTop: spacing.xxl }}
                  />
                </>
              ) : (
                <>
                  <Text variant="heading" accessibilityRole="header">
                    We value your feedback
                  </Text>
                  <Text color="muted" style={{ marginTop: spacing.md }}>
                    Tell us what is working and what is not. It goes straight to the people
                    building GetFit.
                  </Text>

                  <TextField
                    label="Your feedback"
                    placeholder="What would you change?"
                    value={message}
                    onChangeText={(text) => {
                      setMessage(text);
                      if (error) setError(null);
                    }}
                    error={error ?? undefined}
                    hint={
                      remaining < 200
                        ? `${remaining} character${remaining === 1 ? '' : 's'} left`
                        : 'Anything at all — a bug, a missing exercise, something confusing.'
                    }
                    multiline
                    // Hard-stopped at the length the database accepts, so the
                    // field cannot hold a message the server would reject.
                    maxLength={FEEDBACK_MAX_LENGTH}
                    autoCapitalize="sentences"
                    autoCorrect
                    editable={!sending}
                    style={{ marginTop: spacing.xxl }}
                  />

                  <PrimaryButton
                    label="Send feedback"
                    onPress={send}
                    loading={sending}
                    style={{ marginTop: spacing.xxl }}
                  />
                  <SecondaryButton
                    label="Not now"
                    onPress={close}
                    disabled={sending}
                    style={{ marginTop: spacing.md }}
                  />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
