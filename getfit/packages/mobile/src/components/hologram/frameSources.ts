import type { ImageSourcePropType } from 'react-native';
import { nearestRenderedBand } from './frames';

/**
 * The rendered frames themselves.
 *
 * Prepared by `scripts/prepare-hologram-frames.py`: keyed to alpha, framed so
 * the body is the same height in every one, and brightened so React Native's
 * normal blending lands where additive would have.
 *
 * Only the requires live here. Which frame a body gets is in `frames.ts`,
 * where it can be tested without Metro.
 */
const SOURCES: Record<number, ImageSourcePropType> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  15: require('../../../assets/hologram/body-01.png'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  30: require('../../../assets/hologram/body-00.png'),
};

/** The image to draw for a body, or null when the app should draw its own. */
export function frameFor(band: number | undefined): ImageSourcePropType | null {
  const rendered = nearestRenderedBand(band);
  return rendered === null ? null : (SOURCES[rendered] ?? null);
}
