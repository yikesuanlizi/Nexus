export interface TranscriptFollowState {
  following: boolean;
  showReturnToBottom: boolean;
}

export function nextTranscriptFollowState(input: {
  following: boolean;
  distanceFromBottom: number;
  source: 'user' | 'content' | 'return-action';
}): TranscriptFollowState {
  if (input.source === 'return-action') return { following: true, showReturnToBottom: false };
  if (input.source === 'user' && input.distanceFromBottom > 96) {
    return { following: false, showReturnToBottom: true };
  }
  if (input.distanceFromBottom <= 32) return { following: true, showReturnToBottom: false };
  return { following: input.following, showReturnToBottom: !input.following };
}
