/**
 * assets.ts — Firebase Storage の静的アセット URL 定数
 *
 * バケット名や CDN 構成が変わった場合はここだけ修正する。
 * 各コンポーネントでは直接 URL をハードコードせず、この定数を import して使用する。
 */

const STORAGE_BASE =
  "https://storage.googleapis.com/yah-mobile-v1-3ed24.firebasestorage.app";

export const ASSETS = {
  /** ヒーロー動画（デスクトップ用ループ動画・CRF22/高画質・717KB／30fps・音声なし。元: yah_slur_10s.mp4=1577KB） */
  HERO_VIDEO: `${STORAGE_BASE}/assets/videos/yah_slur_10s_desktop_crf22.mp4`,
  /** ヒーロー動画（モバイル用・縦1080×1920・軽量349KB／音声なし） */
  HERO_MOBILE_VIDEO: `${STORAGE_BASE}/assets/videos/yah_slur_10s_mobile.mp4`,
  /** ヒーロー背景画像（モバイル用フォールバック兼poster） */
  HERO_MOBILE_IMG: `${STORAGE_BASE}/assets/images/yah_mobile_HERO_v2.webp`,
  /** 都市イメージ（サービス紹介セクション） */
  CITY_IMG: `${STORAGE_BASE}/assets/images/thumb_09.webp`,
  /** 自然イメージ（サービス紹介セクション） */
  NATURE_IMG: `${STORAGE_BASE}/assets/images/thumb_03.webp`,
} as const;

export type AssetKey = keyof typeof ASSETS;
