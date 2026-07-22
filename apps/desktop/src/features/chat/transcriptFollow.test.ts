import { describe, expect, it } from 'vitest';
import { nextTranscriptFollowState } from './transcriptFollow.js';

describe('nextTranscriptFollowState', () => {
  it('stops following when the user scrolls more than 96px from bottom', () => {
    expect(nextTranscriptFollowState({ following: true, distanceFromBottom: 180, source: 'user' }))
      .toEqual({ following: false, showReturnToBottom: true });
  });

  it('keeps following for streaming content while already at bottom', () => {
    expect(nextTranscriptFollowState({ following: true, distanceFromBottom: 12, source: 'content' }))
      .toEqual({ following: true, showReturnToBottom: false });
  });

  it('returns to following when return-action is triggered', () => {
    expect(nextTranscriptFollowState({ following: false, distanceFromBottom: 200, source: 'return-action' }))
      .toEqual({ following: true, showReturnToBottom: false });
  });

  it('stays following when user scrolls a small distance (<=32px)', () => {
    expect(nextTranscriptFollowState({ following: true, distanceFromBottom: 20, source: 'user' }))
      .toEqual({ following: true, showReturnToBottom: false });
  });

  it('stays not following when content grows but user has scrolled away', () => {
    expect(nextTranscriptFollowState({ following: false, distanceFromBottom: 200, source: 'content' }))
      .toEqual({ following: false, showReturnToBottom: true });
  });

  it('re-follows when distance returns to <=32 even from content source', () => {
    expect(nextTranscriptFollowState({ following: false, distanceFromBottom: 10, source: 'content' }))
      .toEqual({ following: true, showReturnToBottom: false });
  });
});
