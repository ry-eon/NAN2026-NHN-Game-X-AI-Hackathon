// 코드 생성 픽셀 아트 — 외부 에셋 0 원칙 유지 (라이선스 기록 대상 없음).
// 부트 시 12×12 픽셀 맵을 CanvasTexture로 구워 nearest-neighbor 확대(pixelArt)한다.
// 톤: 생존 서사 — 채도 낮은 색, 어두운 외곽선. 유닛은 우향(적이 오는 방향),
// 괴수는 좌향(성벽으로 진격). 스프라이트 교체는 이 파일만 수정하면 된다.

import Phaser from 'phaser'

type Palette = Record<string, number>

const darken = (color: number, f: number): number => {
  const r = Math.floor(((color >> 16) & 0xff) * f)
  const g = Math.floor(((color >> 8) & 0xff) * f)
  const b = Math.floor((color & 0xff) * f)
  return (r << 16) | (g << 8) | b
}

const BASE: Palette = {
  k: 0x1a1a24, // 외곽선
  s: 0xd8b090, // 피부
  m: 0x9aa0ae, // 금속
  w: 0x8a6a42, // 목재
  x: 0xe8e8f0, // 강조(빛)
}

/** 역할별 유닛 스프라이트 (c=역할색, d=어두운 역할색) */
const UNIT_SPRITES: Record<string, { color: number; rows: string[] }> = {
  blocker: {
    color: 0x4e9a5a,
    rows: [
      '............',
      '....kkkk....',
      '...kssssk...',
      '...kssss....',
      '....cccc.mm.',
      '..dcccccdmm.',
      '..dcccccdmm.',
      '..dcccccdmm.',
      '....cc.ccmm.',
      '....dd.dd...',
      '...kk...kk..',
      '............',
    ],
  },
  bruiser: {
    color: 0xc4644a,
    rows: [
      '.........m..',
      '....kkkk.m..',
      '...kssssk.m.',
      '...kssss..m.',
      '....cccc..m.',
      '..dcccccdw..',
      '..dcccccd...',
      '..dcccccd...',
      '....cc.cc...',
      '....dd.dd...',
      '...kk...kk..',
      '............',
    ],
  },
  archer: {
    color: 0x5aa0d0,
    rows: [
      '..........w.',
      '....kkkk.w..',
      '...ksssskw..',
      '...kssss.xw.',
      '....cccc.xw.',
      '..dcccccdxw.',
      '..dcccccd.w.',
      '..dcccccd.w.',
      '....cc.cc.w.',
      '....dd.dd...',
      '...kk...kk..',
      '............',
    ],
  },
  mage: {
    color: 0x8a5ad0,
    rows: [
      '.....ccc..w.',
      '....ccccc.w.',
      '...ccksskcw.',
      '...cckssk.w.',
      '....cccc..x.',
      '..dcccccd.w.',
      '..dcccccd.w.',
      '..dcccccd.w.',
      '....cc.cc.w.',
      '....dd.dd...',
      '...kk...kk..',
      '............',
    ],
  },
  healer: {
    color: 0x5ad0a0,
    rows: [
      '............',
      '....kkkk....',
      '...kssssk...',
      '...kssss....',
      '....cccc....',
      '..dccxccd...',
      '..dcxxxcd...',
      '..dccxccd...',
      '....cc.cc...',
      '....dd.dd...',
      '...kk...kk..',
      '............',
    ],
  },
  slower: {
    color: 0xd0c05a,
    rows: [
      '............',
      '....kkkk....',
      '...kssssk...',
      '...kssss....',
      '....cccc.w..',
      '..dcccccdww.',
      '..dcccccd.w.',
      '..dcccccdww.',
      '....cc.ccw..',
      '....dd.dd...',
      '...kk...kk..',
      '............',
    ],
  },
}

/** 괴수 스프라이트 (e=눈, 좌향) */
const ENEMY_SPRITES: Record<string, { color: number; eye: number; rows: string[] }> = {
  // 야귀: 웅크린 덩어리 귀신
  grunt: {
    color: 0xa04848,
    eye: 0xffd048,
    rows: [
      '............',
      '............',
      '...kkkkkk...',
      '..kccccccck.',
      '.kceccccccck',
      '.kccccccccck',
      '.kceccccccck',
      '.kccccccccck',
      '..kcccccck..',
      '...kc..ck...',
      '..kk...kk...',
      '............',
    ],
  },
  // 질주귀: 앞으로 쏠린 마른 몸
  runner: {
    color: 0xd08a48,
    eye: 0xff5a4a,
    rows: [
      '............',
      '............',
      '............',
      '..kkk.......',
      '.keccK......',
      '.kcccckkk...',
      '..kcccccckk.',
      '...kccccccck',
      '....kc..ck..',
      '...kk...kk..',
      '............',
      '............',
    ],
  },
  // 갑주귀: 철갑 거구
  tank: {
    color: 0x7a4ab0,
    eye: 0xff5a4a,
    rows: [
      '............',
      '..mmmmmmmm..',
      '.mkkkkkkkkm.',
      '.mkcccccckm.',
      '.mkeccccckm.',
      '.mkcccccckm.',
      '.mkeccccckm.',
      '.mkcccccckm.',
      '.mkkkkkkkkm.',
      '..kcc..cck..',
      '..kk....kk..',
      '............',
    ],
  },
  // 파성귀: 등에 노포를 얹은 공성 괴수
  siege: {
    color: 0x9a6a3a,
    eye: 0xffd048,
    rows: [
      '.....ww.....',
      '....wwww....',
      '...kwwwwk...',
      '..kccccccmm.',
      '.keccccccmm.',
      '.kccccccccm.',
      '.kccccccccm.',
      '..kccccccck.',
      '...kkkkkkk..',
      '...kc...ck..',
      '...kk...kk..',
      '............',
    ],
  },
}

/** 타일 질감 (12×12): a=바탕, b=어둡게, l=밝게, m=돌 */
const TILE_SPRITES: Record<string, { palette: Palette; rows: string[] }> = {
  ground: {
    palette: { a: 0x2e2e44, b: 0x28283c, l: 0x36364f },
    rows: [
      'aaaabaaaaaba',
      'abaaaalaaaaa',
      'aaalaaaaabaa',
      'baaaaabaaaal',
      'aaabaaaalaaa',
      'alaaaabaaaba',
      'aaaabaaaaaaa',
      'abaaaaalabaa',
      'aaalabaaaaab',
      'baaaaaabalaa',
      'aabaalaaaaaa',
      'aaaaabaaabaa',
    ],
  },
  road: {
    palette: { a: 0x5c4c36, b: 0x4e402c, l: 0x6a583e, m: 0x71614a },
    rows: [
      'aabaaalaamaa',
      'abaamaaabaal',
      'aaabaalaaaba',
      'laaaabaamaab',
      'aambaaalaaaa',
      'aaaalabaabma',
      'abaaaaambaal',
      'aalamabaaaba',
      'baaaaalaabaa',
      'aabmaabalaam',
      'alaabaaaabaa',
      'aaabaalamaab',
    ],
  },
  wallTop: {
    palette: { a: 0x4a4a66, b: 0x3a3a50, l: 0x585874 },
    rows: [
      'aaaaabaaaaab',
      'alaaabaalaab',
      'aaaaabaaaaab',
      'bbbbbbbbbbbb',
      'aabaaaaabaaa',
      'aabaalaabala',
      'aabaaaaabaaa',
      'bbbbbbbbbbbb',
      'aaaaabaaaaab',
      'alaaabaalaab',
      'aaaaabaaaaab',
      'bbbbbbbbbbbb',
    ],
  },
  blocked: {
    palette: { a: 0x131320, b: 0x0e0e18, l: 0x1a1a2a },
    rows: [
      'aaabaaaaabaa',
      'abaaaalaaaab',
      'aaaaabaaaaaa',
      'aalaaaaabaaa',
      'aaaabaaaaala',
      'abaaaaabaaaa',
      'aaaalaaaaaba',
      'aabaaaabaaaa',
      'alaaabaaalaa',
      'aaaaaaabaaaa',
      'aabalaaaaaba',
      'aaaaaabaalaa',
    ],
  },
}

function drawRows(
  texture: Phaser.Textures.CanvasTexture,
  rows: string[],
  palette: Palette,
): void {
  const ctx = texture.getContext()
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      if (ch === '.') return
      const color = palette[ch]
      if (color === undefined) return
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
      ctx.fillRect(x, y, 1, 1)
    })
  })
  texture.refresh()
}

/** 모든 픽셀 텍스처를 등록 (이미 있으면 스킵 — scene.restart 대응) */
export function registerPixelTextures(scene: Phaser.Scene): void {
  const make = (key: string, rows: string[], palette: Palette): void => {
    if (scene.textures.exists(key)) return
    const t = scene.textures.createCanvas(key, 12, 12)
    if (t) drawRows(t, rows, palette)
  }

  for (const [role, def] of Object.entries(UNIT_SPRITES)) {
    make(`unit-${role}`, def.rows, {
      ...BASE,
      c: def.color,
      d: darken(def.color, 0.62),
      K: BASE.k!,
    })
  }
  for (const [id, def] of Object.entries(ENEMY_SPRITES)) {
    make(`enemy-${id}`, def.rows, {
      ...BASE,
      c: def.color,
      d: darken(def.color, 0.62),
      e: def.eye,
      K: BASE.k!,
    })
  }
  for (const [t, def] of Object.entries(TILE_SPRITES)) {
    make(`tile-${t}`, def.rows, def.palette)
  }
}

/** 괴수 표시 크기 (타일 대비 비율) — 실루엣 위계: 갑주귀 > 파성귀 > 야귀 > 질주귀 */
export const ENEMY_SCALE: Record<string, number> = {
  grunt: 0.62,
  runner: 0.52,
  tank: 0.8,
  siege: 0.72,
}
