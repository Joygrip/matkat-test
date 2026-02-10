import { createLightTheme, BrandVariants, Theme } from '@fluentui/react-components';

/**
 * Ferrosan Medical Devices brand colors
 * Primary: Dark blue from logo background (#1a1a2e)
 * Secondary: Lighter blue variant (#16213e)
 */
const ferrosanBrand: BrandVariants = {
  10: '#0a0a14',
  20: '#0f0f1e',
  30: '#1a1a2e', // Primary brand color
  40: '#1f2a3e',
  50: '#16213e', // Secondary brand color
  60: '#1e2d4a',
  70: '#253956',
  80: '#2d4562',
  90: '#35516e',
  100: '#3d5d7a',
  110: '#456986',
  120: '#4d7592',
  130: '#55819e',
  140: '#5d8daa',
  150: '#6599b6',
  160: '#6da5c2',
};

/**
 * Ferrosan enterprise theme
 * Light theme with Ferrosan blue as primary brand color
 */
export const ferrosanTheme: Theme = createLightTheme(ferrosanBrand);
