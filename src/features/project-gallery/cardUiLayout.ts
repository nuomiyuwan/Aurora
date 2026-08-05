export const HOME_CARD_UI_LAYOUT_VERSION = 'home-card-ui-v5'

export const HOME_CARD_BASE_WIDTH = 610
export const HOME_CARD_BASE_HEIGHT = (HOME_CARD_BASE_WIDTH * 1080) / 1448
export const HOME_CARD_GLASS_CORNER_RADIUS_RATIO = 64 / 1448

export const HOME_CARD_COPY_LAYOUT = {
  left: 52,
  bottom: 62,
  width: 440,
  height: 84,
  titleSize: 18.5,
  subtitleSize: 10.5,
  metaSize: 9.5,
  lineGap: 4,
  subtitleGap: 12,
  metaGap: 10,
} as const

const copyTitleLineHeight = HOME_CARD_COPY_LAYOUT.titleSize * 1.2
const copySubtitleLineHeight = HOME_CARD_COPY_LAYOUT.subtitleSize * 1.25
const copyMetaLineHeight = HOME_CARD_COPY_LAYOUT.metaSize * 1.3

export const HOME_CARD_COPY_ROW_TOPS = {
  title: 0,
  subtitle: copyTitleLineHeight + HOME_CARD_COPY_LAYOUT.lineGap,
  stats:
    copyTitleLineHeight +
    HOME_CARD_COPY_LAYOUT.lineGap +
    copySubtitleLineHeight +
    HOME_CARD_COPY_LAYOUT.subtitleGap +
    HOME_CARD_COPY_LAYOUT.lineGap,
  updated:
    copyTitleLineHeight +
    HOME_CARD_COPY_LAYOUT.lineGap +
    copySubtitleLineHeight +
    HOME_CARD_COPY_LAYOUT.subtitleGap +
    HOME_CARD_COPY_LAYOUT.lineGap +
    copyMetaLineHeight +
    HOME_CARD_COPY_LAYOUT.lineGap,
} as const

export const HOME_CARD_STATUS_LAYOUT = {
  top: 48,
  right: 55,
  fontSize: 9,
  paddingX: 8,
  paddingY: 5,
  radius: 8,
} as const

export const HOME_CARD_MENU_LAYOUT = {
  right: 48,
  bottom: 57,
  size: 17,
} as const
