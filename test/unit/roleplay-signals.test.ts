import { describe, expect, it } from 'vitest';
import { isRoleplayDoorSlam } from '../../roleplay-signals';

describe('role-play termination protocol', () => {
  it('does not end a scene for ordinary dialogue or a valid score', () => {
    for (const text of ['', 'What did you find on my roof?', 'AGNES SCORE: 85', 'You earned 85 out of 100.']) {
      expect(isRoleplayDoorSlam(text)).toBe(false);
    }
  });
  it('preserves the original phrase and model marker signals', () => {
    expect(isRoleplayDoorSlam('DOOR SLAM')).toBe(true);
    expect(isRoleplayDoorSlam('\u{1F6AA}\u{1F4A5}')).toBe(true);
  });
});
