/**
 * WCAG colour maths, used to keep the palette honest.
 *
 * Every surface in the app is translucent, so the colour a user actually reads
 * against is not written down anywhere — it is whatever the glass composites to
 * over the field behind it. These helpers do that compositing, which lets
 * `tests/palette.test.ts` assert real contrast ratios on the real stack of
 * layers instead of on the token values in isolation.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0-1. Opaque colours carry 1. */
  a: number;
}

/** Parses `#RGB`, `#RRGGBB`, `rgb(…)` and `rgba(…)`. Throws on anything else. */
export function parseColor(value: string): Rgb {
  const input = value.trim();

  if (input.startsWith('#')) {
    const hex = input.slice(1);
    if (hex.length === 3) {
      return {
        r: Number.parseInt(hex[0] + hex[0], 16),
        g: Number.parseInt(hex[1] + hex[1], 16),
        b: Number.parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    throw new Error(`Unsupported hex colour: ${value}`);
  }

  const match = /^rgba?\(([^)]+)\)$/i.exec(input);
  if (!match) throw new Error(`Unsupported colour: ${value}`);

  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Unsupported colour: ${value}`);
  }

  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** Paints `foreground` onto `background`, returning the opaque result. */
export function composite(foreground: string, background: string): string {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (bg.a !== 1) throw new Error('composite needs an opaque background');

  const blend = (f: number, b: number): number => Math.round(f * fg.a + b * (1 - fg.a));
  return toHex({ r: blend(fg.r, bg.r), g: blend(fg.g, bg.g), b: blend(fg.b, bg.b), a: 1 });
}

/** Paints a whole stack, bottom first, so a card on a field reads as one colour. */
export function compositeStack(background: string, ...layers: string[]): string {
  return layers.reduce((base, layer) => composite(layer, base), background);
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
  return `#${part(r)}${part(g)}${part(b)}`;
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. The colour must be opaque. */
export function relativeLuminance(color: string): number {
  const { r, g, b, a } = parseColor(color);
  if (a !== 1) throw new Error('relativeLuminance needs an opaque colour');
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/**
 * WCAG contrast ratio, 1 (identical) to 21 (black on white).
 *
 * A translucent foreground is composited onto the background first, which is
 * what actually happens on screen — `rgba(255,255,255,0.78)` text is not white.
 */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseColor(foreground);
  const solidForeground = fg.a === 1 ? foreground : composite(foreground, background);

  const a = relativeLuminance(solidForeground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
