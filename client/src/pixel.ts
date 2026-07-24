// 코드 생성 픽셀 아트 v2 (24×24) — 외부 에셋 0 원칙 유지 (docs/asset-licenses.md).
// 유닛 = 공용 신체 템플릿 × 역할 장비 오버레이 합성 (스타일 일관성을 구조로 보장).
// 괴수 = 수제 24×24 (실루엣 변별이 생명). 타일 = 결정론적 패턴 생성.
// 톤: 생존 서사 — 낮은 채도, 어두운 외곽선. 유닛 우향, 괴수 좌향.

import Phaser from 'phaser'

const SIZE = 24

type Palette = Record<string, number>

const darken = (color: number, f: number): number => {
  const r = Math.floor(((color >> 16) & 0xff) * f)
  const g = Math.floor(((color >> 8) & 0xff) * f)
  const b = Math.floor((color & 0xff) * f)
  return (r << 16) | (g << 8) | b
}

const BASE: Palette = {
  k: 0x171720, // 외곽선
  s: 0xd8b090, // 피부
  S: 0xb08a68, // 피부 음영
  h: 0x3a3230, // 머리카락
  m: 0xaab0be, // 금속 밝음
  M: 0x767c8c, // 금속 음영
  w: 0x8a6a42, // 목재
  W: 0x6e5232, // 목재 음영
  x: 0xe8e8f0, // 강조(빛·천)
  e: 0xffd048, // 발광(눈·보석)
}

/** 행 배열을 SIZE×SIZE로 정규화 (짧은 행은 '.' 패딩 — 저작 실수 방지) */
const norm = (rows: string[]): string[] => {
  const out = rows.slice(0, SIZE).map((r) => (r + '.'.repeat(SIZE)).slice(0, SIZE))
  while (out.length < SIZE) out.push('.'.repeat(SIZE))
  return out
}

/** overlay의 '.'이 아닌 셀이 base를 덮는다 */
const merge = (base: string[], overlay: string[]): string[] =>
  norm(base).map((row, y) => {
    const over = norm(overlay)[y]!
    return [...row].map((ch, x) => (over[x] !== '.' ? over[x]! : ch)).join('')
  })

// ---------------------------------------------------------------- 유닛: 공용 신체

const BODY: string[] = [
  '........................',
  '........................',
  '..........kkkk..........',
  '.........khhhhk.........',
  '........khhhhhhk........',
  '........khssssk.........',
  '........kssssek.........',
  '........kSssssk.........',
  '.........kSSk...........',
  '........kccccck.........',
  '.......kccccccck........',
  '......kdcccccccdk.......',
  '......kdcccccccdk.......',
  '......ksdcccccdsk.......',
  '......k.dcccccd.k.......',
  '........dcccccd.........',
  '........kkkkkkk.........',
  '........dcc.ccd.........',
  '........dcc.ccd.........',
  '........dcc.ccd.........',
  '........kcc.cck.........',
  '.......kkk...kkk........',
  '........................',
  '........................',
]

/** 역할별 장비 오버레이 (우측 = 적 방향) */
const GEAR: Record<string, string[]> = {
  blocker: [
    // 대형 방패 + 투구
    '........................',
    '........................',
    '..........mmmm..........',
    '.........mkkkkm.........',
    '........................',
    '........................',
    '........................',
    '................kkkk....',
    '...............kmmmmk...',
    '...............kmMMmk...',
    '...............kmMMmk...',
    '...............kmMMmk...',
    '...............kmMMmk...',
    '...............kmMMmk...',
    '...............kmmmmk...',
    '................kkkk....',
  ],
  bruiser: [
    // 대검
    '..................km....',
    '..................km....',
    '..................km....',
    '..................km....',
    '..................km....',
    '..................km....',
    '..................km....',
    '..................km....',
    '..................km....',
    '..................km....',
    '.................kmmk...',
    '................kwwwwk..',
    '..................ss....',
  ],
  archer: [
    // 활 + 시위
    '...................w....',
    '..................w.x...',
    '.................w..x...',
    '.................w..x...',
    '................w...x...',
    '................w...x...',
    '................w...x...',
    '................w...x...',
    '................w...x...',
    '................w...x...',
    '.................w..x...',
    '.................w..x...',
    '..................w.x...',
    '...................w....',
  ],
  mage: [
    // 후드 + 지팡이(발광 보석)
    '..........cccc..........',
    '.........cccccc.........',
    '........cckkkkcc........',
    '........cc....cc........',
    '..................ee....',
    '.................kwwk...',
    '..................ww....',
    '..................ww....',
    '..................ww....',
    '..................ww....',
    '..................ww....',
    '..................ww....',
    '..................ww....',
    '..................ww....',
    '..................ww....',
  ],
  healer: [
    // 가슴 십자 + 어깨 가방
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.........x..x...........',
    '........xxxxxx..........',
    '.........x..x...........',
    '......ww................',
    '......ww................',
  ],
  slower: [
    // 어깨 그물 + 말뚝 덫
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '.....wxwxw..............',
    '.....xwxwx..............',
    '.....wxwxw..............',
    '........................',
    '..................k.k...',
    '..................w.w...',
    '..................w.w...',
  ],
}

const ROLE_COLORS: Record<string, number> = {
  barricade: 0x8a6a42,
  watchtower: 0x9aa0ae,
  cauldron: 0x6e5232,
  blocker: 0x4e9a5a,
  bruiser: 0xc4644a,
  archer: 0x5aa0d0,
  mage: 0x8a5ad0,
  healer: 0x5ad0a0,
  slower: 0xd0c05a,
}

/** 시설 스프라이트 (신체 템플릿 미사용 — 구조물) */
const STRUCTURE_SPRITES: Record<string, string[]> = {
  barricade: [
    '........................',
    '........................',
    '........................',
    '....k..........k........',
    '...kwk...k....kwk.......',
    '...kwwk.kwk..kwwk.......',
    '..kwWwkkwwwkkwWwk.......',
    '..kwwWwwwWwwwwwwk.......',
    '..kwWwwwwwwWwwWwk.......',
    '..kwwwWwwwwwwwwwk.......',
    '.kwwWwwwwWwwwWwwwk......',
    '.kwwwwwWwwwwwwwWwk......',
    '.kwWwwwwwwwWwwwwwk......',
    '.kkkkkkkkkkkkkkkkk......',
    '........................',
  ],
  watchtower: [
    '........................',
    '....m.m.m.m.............',
    '....mmmmmmm.............',
    '....mMMMMMm.............',
    '....mMkkkMm.............',
    '....mMkekMm.............',
    '....mMkkkMm.............',
    '....mMMMMMm.............',
    '.....mMMMm..............',
    '.....mMMMm..............',
    '.....mMMMm..............',
    '.....mMMMm..............',
    '....mMMMMMm.............',
    '....kkkkkkk.............',
    '........................',
  ],
  cauldron: [
    '........................',
    '......e..e..............',
    '.....e.ee.e.............',
    '......eeee..............',
    '....kkkkkkkk............',
    '...kWWWWWWWWk...........',
    '...kWwwwwwWWk...........',
    '...kWwwwwwWWk...........',
    '....kWwwwWWk............',
    '.....kkkkkk.............',
    '....kw....wk............',
    '....kw....wk............',
    '...kkk....kkk...........',
    '........................',
  ],
}

// ---------------------------------------------------------------- 괴수 (좌향)

const ENEMY_SPRITES: Record<string, { color: number; eye: number; rows: string[] }> = {
  // 야귀: 웅크린 덩어리 — 큰 아가리, 낮은 자세
  grunt: {
    color: 0x9a4444,
    eye: 0xffd048,
    rows: [
      '........................',
      '........................',
      '........................',
      '.........kkkkkk.........',
      '.......kkcccccckk.......',
      '......kcccccccccck......',
      '.....kcccccccccccck.....',
      '....kceeccccccccccck....',
      '....kccccccccccccdck....',
      '....kceeccccccccccck....',
      '....kccccccccccccdck....',
      '....kxcxcxccccccccck....',
      '....kccccccccccccck.....',
      '.....kcccccccccdck......',
      '......kccccccccck.......',
      '.......kcck..kcck.......',
      '.......kck....kck.......',
      '......kkk....kkk........',
      '........................',
    ],
  },
  // 질주귀: 앞으로 쏠린 마른 몸 — 긴 팔다리
  runner: {
    color: 0xc07c3e,
    eye: 0xff5a4a,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '....kkk.................',
      '...keeck................',
      '...kcccck...............',
      '....kcccckkk............',
      '.....kccccccckkk........',
      '......kcccccccccckk.....',
      '.......kccccccccccck....',
      '........kcccccccccck....',
      '.......kccck...kccck....',
      '......kcck.......kcck...',
      '.....kck...........kck..',
      '....kk...............kk.',
      '........................',
    ],
  },
  // 갑주귀: 철갑 거구 — 투구 틈의 눈
  tank: {
    color: 0x6a4a9a,
    eye: 0xff5a4a,
    rows: [
      '........................',
      '.....mmmmmmmmmmmm.......',
      '....mkkkkkkkkkkkkm......',
      '...mkMMMMMMMMMMMMkm.....',
      '...mkMccccccccccMkm.....',
      '...mkMccccccccccMkm.....',
      '...mkeecccccccccMkm.....',
      '...mkMccccccccccMkm.....',
      '...mkeecccccccccMkm.....',
      '...mkMccccccccccMkm.....',
      '...mkMccccccccccMkm.....',
      '...mkMccccccccccMkm.....',
      '...mkkkkkkkkkkkkkkm.....',
      '....mmcccm..mcccmm......',
      '.....kcck....kcck.......',
      '.....kcck....kcck.......',
      '....kkkk....kkkk........',
      '........................',
    ],
  },
  // 파성귀: 등에 노포를 얹은 공성 괴수
  siege: {
    color: 0x8a5e34,
    eye: 0xffd048,
    rows: [
      '..........ww............',
      '.........wwww...........',
      '........kwwwwk..........',
      '.........kwwk...........',
      '......kkkkwwkkkkk.......',
      '.....kccccwwccccck......',
      '....kcccccccccccccm.....',
      '...kceeccccccccccMm.....',
      '...kcccccccccccccMm.....',
      '...kceeccccccccccMm.....',
      '...kcccccccccccccMm.....',
      '....kccccccccccccm......',
      '.....kkcccccccckk.......',
      '......kcck..kcck........',
      '......kcck..kcck........',
      '.....kkkk..kkkk.........',
      '........................',
    ],
  },
}

// ---------------------------------------------------------------- 타일 (패턴 생성)

/** 결정론 해시 — 연출 전용 (core 밖), 시드 필요 없음 */
const speckle = (x: number, y: number, salt: number): number =>
  (x * 73856093 + y * 19349663 + salt * 83492791) % 100

function tilePixels(kind: string): { palette: Palette; rows: string[] } {
  const rows: string[] = []
  if (kind === 'wallTop') {
    // 벽돌: 4단, 단마다 오프셋
    for (let y = 0; y < SIZE; y++) {
      let row = ''
      for (let x = 0; x < SIZE; x++) {
        const mortarH = y % 6 === 5
        const offset = Math.floor(y / 6) % 2 === 0 ? 0 : 6
        const mortarV = (x + offset) % 12 === 11
        if (mortarH || mortarV) row += 'b'
        else row += speckle(x, y, 1) < 8 ? 'l' : 'a'
      }
      rows.push(row)
    }
    return { palette: { a: 0x4a4a66, b: 0x35354c, l: 0x5a5a78 }, rows }
  }
  if (kind === 'road') {
    for (let y = 0; y < SIZE; y++) {
      let row = ''
      for (let x = 0; x < SIZE; x++) {
        const n = speckle(x, y, 2)
        row += n < 6 ? 'm' : n < 16 ? 'b' : n < 24 ? 'l' : 'a'
      }
      rows.push(row)
    }
    return { palette: { a: 0x5c4c36, b: 0x4c3f2c, l: 0x6c5a40, m: 0x74644c }, rows }
  }
  if (kind === 'blocked') {
    for (let y = 0; y < SIZE; y++) {
      let row = ''
      for (let x = 0; x < SIZE; x++) {
        const n = speckle(x, y, 3)
        row += n < 7 ? 'l' : n < 15 ? 'b' : 'a'
      }
      rows.push(row)
    }
    return { palette: { a: 0x121220, b: 0x0d0d16, l: 0x1a1a2c }, rows }
  }
  // ground: 이끼 낀 어두운 땅
  for (let y = 0; y < SIZE; y++) {
    let row = ''
    for (let x = 0; x < SIZE; x++) {
      const n = speckle(x, y, 4)
      row += n < 5 ? 'g' : n < 13 ? 'b' : n < 20 ? 'l' : 'a'
    }
    rows.push(row)
  }
  return { palette: { a: 0x2e2e46, b: 0x27273a, l: 0x363652, g: 0x2f4040 }, rows }
}

// ---------------------------------------------------------------- 등록

function drawRows(
  texture: Phaser.Textures.CanvasTexture,
  rows: string[],
  palette: Palette,
): void {
  const ctx = texture.getContext()
  norm(rows).forEach((row, y) => {
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
    const t = scene.textures.createCanvas(key, SIZE, SIZE)
    if (t) drawRows(t, rows, palette)
  }

  for (const [role, color] of Object.entries(ROLE_COLORS)) {
    make(`unit-${role}`, merge(BODY, GEAR[role] ?? []), {
      ...BASE,
      c: color,
      d: darken(color, 0.6),
    })
  }
  for (const [id, rows] of Object.entries(STRUCTURE_SPRITES)) {
    make(`unit-${id}`, rows, { ...BASE, c: ROLE_COLORS[id]!, d: darken(ROLE_COLORS[id]!, 0.6) })
  }
  for (const [id, def] of Object.entries(ENEMY_SPRITES)) {
    make(`enemy-${id}`, def.rows, {
      ...BASE,
      c: def.color,
      d: darken(def.color, 0.6),
      x: darken(def.color, 0.35), // 괴수의 x = 아가리/균열 (BASE의 밝은 x 대체)
      e: def.eye,
    })
  }
  for (const kind of ['ground', 'road', 'wallTop', 'blocked']) {
    const { palette, rows } = tilePixels(kind)
    make(`tile-${kind}`, rows, palette)
  }
}

/** 괴수 표시 크기 (타일 대비 비율) — 실루엣 위계: 갑주귀 > 파성귀 > 야귀 > 질주귀 */
export const ENEMY_SCALE: Record<string, number> = {
  grunt: 0.66,
  runner: 0.58,
  tank: 0.84,
  siege: 0.76,
}
