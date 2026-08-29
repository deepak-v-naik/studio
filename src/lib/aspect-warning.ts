// Aspect-ratio fit check mirroring ALIVE-Player PlaybackEngine.kt chooseScaleType:
// the player fills the screen (center-crop) only while the creative's aspect ratio is
// within MAX_FILL_ASPECT_RATIO of the screen's; past that it letterboxes (fit), which
// on a 9:16 portrait screen shrinks a square 1:1 logo to ~56% of the screen height.
// Client-safe — no server imports.

export const MAX_FILL_ASPECT_RATIO = 1.35;

export type ScreenOrientation = 'portrait' | 'landscape';

const SCREEN_ASPECT: Record<ScreenOrientation, number> = {
  portrait:  9 / 16,
  landscape: 16 / 9,
};

export const SUGGESTED_RESOLUTION: Record<ScreenOrientation, string> = {
  portrait:  '1080×1920',
  landscape: '1920×1080',
};

/** True when a width×height creative letterboxes on a screen of the given orientation. */
export function willLetterbox(width: number, height: number, orientation: ScreenOrientation): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const content  = width / height;
  const screen   = SCREEN_ASPECT[orientation];
  const mismatch = content > screen ? content / screen : screen / content;
  return mismatch > MAX_FILL_ASPECT_RATIO;
}
