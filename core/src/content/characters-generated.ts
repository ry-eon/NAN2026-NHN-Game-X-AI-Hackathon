// ⚠️ 자동 생성 파일 — 직접 편집 금지.
// pipeline(`pnpm pipeline:chars`)이 pipeline/characters/*.json(밸런스 검증 통과)에서 재생성.
// 영입 풀 — 시작 가신 3인(도하/세아/단비) 외의 캐릭터는 여기서 영입된다.

import type { CharacterDef } from '../types'

export const CHARACTER_POOL: CharacterDef[] = [
  {
    "id": "c-7002",
    "name": "도린",
    "placement": "wallTop",
    "cost": 13,
    "hp": 398,
    "atk": 142,
    "def": 5,
    "atkIntervalTicks": 60,
    "range": 3,
    "blockCount": 0,
    "redeployTicks": 900,
    "aoeRadius": 1.3,
    "role": "mage",
    "epithet": "마지막 보루의",
    "lore": "함락된 북쪽 초소 출신. 스승을(를) 잃고, 다시는 잃지 않으려 성벽에 섰다.",
    "lines": {
      "deploy": "자리는 내가 지킨다.",
      "skill": "지금이다!",
      "victory": "아직 살아 있다."
    },
    "skillSet": {
      "passive": {
        "id": "p-eagle",
        "name": "매의 눈",
        "desc": "사거리 +0.5 (원거리 전용).",
        "slot": "passive",
        "effect": {
          "kind": "statMod",
          "rangeAdd": 0.5
        }
      },
      "auto": {
        "id": "a-bulwark",
        "name": "방벽",
        "desc": "12초마다 피해를 흡수하는 보호막 150.",
        "slot": "auto",
        "effect": {
          "kind": "shield",
          "amount": 150,
          "intervalTicks": 360
        }
      },
      "active": {
        "id": "x-nova",
        "name": "충격파",
        "desc": "자기 주변 1.6타일에 방어 무시 250 피해.",
        "slot": "active",
        "effect": {
          "kind": "nova",
          "damage": 250,
          "radius": 1.6
        },
        "cooldownTicks": 1050
      }
    }
  },
  {
    "id": "c-7003",
    "name": "하린",
    "placement": "ground",
    "cost": 11,
    "hp": 838,
    "atk": 225,
    "def": 25,
    "atkIntervalTicks": 39,
    "range": 0,
    "blockCount": 1,
    "redeployTicks": 900,
    "role": "bruiser",
    "epithet": "밤을 걷는",
    "lore": "함락된 북쪽 초소 출신. 왼눈을(를) 잃고, 돌아갈 곳이 없어 성벽에 섰다.",
    "lines": {
      "deploy": "시작하지.",
      "skill": "무너져라!",
      "victory": "아직 살아 있다."
    },
    "skillSet": {
      "passive": {
        "id": "p-pierce",
        "name": "꿰뚫기",
        "desc": "적 방어력을 50% 무시한다.",
        "slot": "passive",
        "effect": {
          "kind": "armorPierce",
          "ratio": 0.5
        }
      },
      "auto": {
        "id": "a-regen",
        "name": "재생",
        "desc": "3초마다 40 회복.",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 1,
          "amount": 40,
          "cooldownTicks": 90
        }
      },
      "active": {
        "id": "x-repel",
        "name": "밀쳐내기",
        "desc": "저지 중인 적을 2타일 밀쳐내고 저지를 푼다.",
        "slot": "active",
        "effect": {
          "kind": "knockback",
          "tiles": 2
        },
        "cooldownTicks": 750
      }
    }
  },
  {
    "id": "c-7004",
    "name": "은람",
    "placement": "wallTop",
    "cost": 9,
    "hp": 444,
    "atk": 124,
    "def": 10,
    "atkIntervalTicks": 30,
    "range": 3.5,
    "blockCount": 0,
    "redeployTicks": 900,
    "role": "archer",
    "epithet": "잿빛",
    "lore": "폐쇄된 갱도 출신. 전우을(를) 잃고, 다시는 잃지 않으려 성벽에 섰다.",
    "lines": {
      "deploy": "자리는 내가 지킨다.",
      "skill": "무너져라!",
      "victory": "수고했다, 모두."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-bulwark",
        "name": "방벽",
        "desc": "12초마다 피해를 흡수하는 보호막 150.",
        "slot": "auto",
        "effect": {
          "kind": "shield",
          "amount": 150,
          "intervalTicks": 360
        }
      },
      "active": {
        "id": "x-repel",
        "name": "밀쳐내기",
        "desc": "저지 중인 적을 2타일 밀쳐내고 저지를 푼다.",
        "slot": "active",
        "effect": {
          "kind": "knockback",
          "tiles": 2
        },
        "cooldownTicks": 750
      }
    }
  },
  {
    "id": "c-7005",
    "name": "수해",
    "placement": "ground",
    "cost": 14,
    "hp": 1330,
    "atk": 95,
    "def": 40,
    "atkIntervalTicks": 45,
    "range": 0,
    "blockCount": 3,
    "redeployTicks": 900,
    "role": "blocker",
    "epithet": "마지막 보루의",
    "lore": "무너진 등대 출신. 왼눈을(를) 잃고, 돌아갈 곳이 없어 성벽에 섰다.",
    "lines": {
      "deploy": "자리는 내가 지킨다.",
      "skill": "무너져라!",
      "victory": "성은 지켜졌다."
    },
    "skillSet": {
      "passive": {
        "id": "p-pierce",
        "name": "꿰뚫기",
        "desc": "적 방어력을 50% 무시한다.",
        "slot": "passive",
        "effect": {
          "kind": "armorPierce",
          "ratio": 0.5
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-frenzy",
        "name": "전의 폭발",
        "desc": "6초간 공격 속도 2배.",
        "slot": "active",
        "effect": {
          "kind": "frenzy",
          "atkSpeedMul": 2,
          "durationTicks": 180
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7006",
    "name": "재온",
    "placement": "ground",
    "cost": 14,
    "hp": 1509,
    "atk": 89,
    "def": 40,
    "atkIntervalTicks": 45,
    "range": 0,
    "blockCount": 3,
    "redeployTicks": 900,
    "role": "blocker",
    "epithet": "불씨를 쥔",
    "lore": "버려진 수도원 출신. 왼눈을(를) 잃고, 빚을 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "숨죽여라.",
      "skill": "무너져라!",
      "victory": "성은 지켜졌다."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-second-wind",
        "name": "재기",
        "desc": "즉시 400 회복.",
        "slot": "active",
        "effect": {
          "kind": "heal",
          "amount": 400
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7007",
    "name": "온람",
    "placement": "wallTop",
    "cost": 9,
    "hp": 415,
    "atk": 123,
    "def": 10,
    "atkIntervalTicks": 30,
    "range": 3.5,
    "blockCount": 0,
    "redeployTicks": 900,
    "role": "archer",
    "epithet": "마지막 보루의",
    "lore": "얼어붙은 나루터 출신. 가족을(를) 잃고, 다시는 잃지 않으려 성벽에 섰다.",
    "lines": {
      "deploy": "…왔군.",
      "skill": "…끝을 보자.",
      "victory": "…다음이 또 온다."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-mend",
        "name": "응급 처치",
        "desc": "HP 50% 미만이 되면 200 회복 (8초 주기).",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 0.5,
          "amount": 200,
          "cooldownTicks": 240
        }
      },
      "active": {
        "id": "x-nova",
        "name": "충격파",
        "desc": "자기 주변 1.6타일에 방어 무시 250 피해.",
        "slot": "active",
        "effect": {
          "kind": "nova",
          "damage": 250,
          "radius": 1.6
        },
        "cooldownTicks": 1050
      }
    }
  },
  {
    "id": "c-7009",
    "name": "온아",
    "placement": "ground",
    "cost": 14,
    "hp": 1418,
    "atk": 90,
    "def": 40,
    "atkIntervalTicks": 45,
    "range": 0,
    "blockCount": 3,
    "redeployTicks": 900,
    "role": "blocker",
    "epithet": "침묵하는",
    "lore": "얼어붙은 나루터 출신. 전우을(를) 잃고, 다시는 잃지 않으려 성벽에 섰다.",
    "lines": {
      "deploy": "숨죽여라.",
      "skill": "…끝을 보자.",
      "victory": "아직 살아 있다."
    },
    "skillSet": {
      "passive": {
        "id": "p-guard",
        "name": "수호 본능",
        "desc": "저지 수 +1.",
        "slot": "passive",
        "effect": {
          "kind": "statMod",
          "blockAdd": 1
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-repel",
        "name": "밀쳐내기",
        "desc": "저지 중인 적을 2타일 밀쳐내고 저지를 푼다.",
        "slot": "active",
        "effect": {
          "kind": "knockback",
          "tiles": 2
        },
        "cooldownTicks": 750
      }
    }
  },
  {
    "id": "c-7010",
    "name": "유주",
    "placement": "ground",
    "cost": 11,
    "hp": 840,
    "atk": 238,
    "def": 25,
    "atkIntervalTicks": 39,
    "range": 0,
    "blockCount": 1,
    "redeployTicks": 900,
    "role": "bruiser",
    "epithet": "침묵하는",
    "lore": "얼어붙은 나루터 출신. 왼눈을(를) 잃고, 빚을 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "…왔군.",
      "skill": "지금이다!",
      "victory": "오늘 몫은 했다."
    },
    "skillSet": {
      "passive": {
        "id": "p-pierce",
        "name": "꿰뚫기",
        "desc": "적 방어력을 50% 무시한다.",
        "slot": "passive",
        "effect": {
          "kind": "armorPierce",
          "ratio": 0.5
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-frenzy",
        "name": "전의 폭발",
        "desc": "6초간 공격 속도 2배.",
        "slot": "active",
        "effect": {
          "kind": "frenzy",
          "atkSpeedMul": 2,
          "durationTicks": 180
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7011",
    "name": "도찬",
    "placement": "wallTop",
    "cost": 13,
    "hp": 380,
    "atk": 155,
    "def": 5,
    "atkIntervalTicks": 60,
    "range": 3,
    "blockCount": 0,
    "redeployTicks": 900,
    "aoeRadius": 1.3,
    "role": "mage",
    "epithet": "한파의",
    "lore": "폐쇄된 갱도 출신. 가족을(를) 잃고, 돌아갈 곳이 없어 성벽에 섰다.",
    "lines": {
      "deploy": "여기까지다.",
      "skill": "…끝을 보자.",
      "victory": "수고했다, 모두."
    },
    "skillSet": {
      "passive": {
        "id": "p-eagle",
        "name": "매의 눈",
        "desc": "사거리 +0.5 (원거리 전용).",
        "slot": "passive",
        "effect": {
          "kind": "statMod",
          "rangeAdd": 0.5
        }
      },
      "auto": {
        "id": "a-regen",
        "name": "재생",
        "desc": "3초마다 40 회복.",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 1,
          "amount": 40,
          "cooldownTicks": 90
        }
      },
      "active": {
        "id": "x-second-wind",
        "name": "재기",
        "desc": "즉시 400 회복.",
        "slot": "active",
        "effect": {
          "kind": "heal",
          "amount": 400
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7012",
    "name": "란영",
    "placement": "ground",
    "cost": 11,
    "hp": 925,
    "atk": 242,
    "def": 25,
    "atkIntervalTicks": 39,
    "range": 0,
    "blockCount": 1,
    "redeployTicks": 900,
    "role": "bruiser",
    "epithet": "재투성이",
    "lore": "얼어붙은 나루터 출신. 고향을(를) 잃고, 괴수의 피를 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "벽 뒤로 물러서라.",
      "skill": "버텨!",
      "victory": "…다음이 또 온다."
    },
    "skillSet": {
      "passive": {
        "id": "p-guard",
        "name": "수호 본능",
        "desc": "저지 수 +1.",
        "slot": "passive",
        "effect": {
          "kind": "statMod",
          "blockAdd": 1
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-second-wind",
        "name": "재기",
        "desc": "즉시 400 회복.",
        "slot": "active",
        "effect": {
          "kind": "heal",
          "amount": 400
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7013",
    "name": "수온",
    "placement": "ground",
    "cost": 11,
    "hp": 945,
    "atk": 252,
    "def": 25,
    "atkIntervalTicks": 39,
    "range": 0,
    "blockCount": 1,
    "redeployTicks": 900,
    "role": "bruiser",
    "epithet": "상처 입은",
    "lore": "얼어붙은 나루터 출신. 스승을(를) 잃고, 빚을 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "숨죽여라.",
      "skill": "지금이다!",
      "victory": "…다음이 또 온다."
    },
    "skillSet": {
      "passive": {
        "id": "p-guard",
        "name": "수호 본능",
        "desc": "저지 수 +1.",
        "slot": "passive",
        "effect": {
          "kind": "statMod",
          "blockAdd": 1
        }
      },
      "auto": {
        "id": "a-regen",
        "name": "재생",
        "desc": "3초마다 40 회복.",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 1,
          "amount": 40,
          "cooldownTicks": 90
        }
      },
      "active": {
        "id": "x-nova",
        "name": "충격파",
        "desc": "자기 주변 1.6타일에 방어 무시 250 피해.",
        "slot": "active",
        "effect": {
          "kind": "nova",
          "damage": 250,
          "radius": 1.6
        },
        "cooldownTicks": 1050
      }
    }
  },
  {
    "id": "c-7014",
    "name": "서람",
    "placement": "wallTop",
    "cost": 9,
    "hp": 449,
    "atk": 135,
    "def": 10,
    "atkIntervalTicks": 30,
    "range": 3.5,
    "blockCount": 0,
    "redeployTicks": 900,
    "role": "archer",
    "epithet": "한파의",
    "lore": "재가 된 시장거리 출신. 고향을(를) 잃고, 다시는 잃지 않으려 성벽에 섰다.",
    "lines": {
      "deploy": "여기까지다.",
      "skill": "지금이다!",
      "victory": "…다음이 또 온다."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-frenzy",
        "name": "전의 폭발",
        "desc": "6초간 공격 속도 2배.",
        "slot": "active",
        "effect": {
          "kind": "frenzy",
          "atkSpeedMul": 2,
          "durationTicks": 180
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7015",
    "name": "수솔",
    "placement": "wallTop",
    "cost": 9,
    "hp": 458,
    "atk": 122,
    "def": 10,
    "atkIntervalTicks": 30,
    "range": 3.5,
    "blockCount": 0,
    "redeployTicks": 900,
    "role": "archer",
    "epithet": "상처 입은",
    "lore": "무너진 동쪽 관문 출신. 스승을(를) 잃고, 다시는 잃지 않으려 성벽에 섰다.",
    "lines": {
      "deploy": "여기까지다.",
      "skill": "무너져라!",
      "victory": "…다음이 또 온다."
    },
    "skillSet": {
      "passive": {
        "id": "p-pierce",
        "name": "꿰뚫기",
        "desc": "적 방어력을 50% 무시한다.",
        "slot": "passive",
        "effect": {
          "kind": "armorPierce",
          "ratio": 0.5
        }
      },
      "auto": {
        "id": "a-bulwark",
        "name": "방벽",
        "desc": "12초마다 피해를 흡수하는 보호막 150.",
        "slot": "auto",
        "effect": {
          "kind": "shield",
          "amount": 150,
          "intervalTicks": 360
        }
      },
      "active": {
        "id": "x-nova",
        "name": "충격파",
        "desc": "자기 주변 1.6타일에 방어 무시 250 피해.",
        "slot": "active",
        "effect": {
          "kind": "nova",
          "damage": 250,
          "radius": 1.6
        },
        "cooldownTicks": 1050
      }
    }
  },
  {
    "id": "c-7016",
    "name": "채목",
    "placement": "ground",
    "cost": 14,
    "hp": 1317,
    "atk": 97,
    "def": 40,
    "atkIntervalTicks": 45,
    "range": 0,
    "blockCount": 3,
    "redeployTicks": 900,
    "role": "blocker",
    "epithet": "무너진 문의",
    "lore": "폐쇄된 갱도 출신. 왼눈을(를) 잃고, 괴수의 피를 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "숨죽여라.",
      "skill": "버텨!",
      "victory": "오늘 몫은 했다."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-repel",
        "name": "밀쳐내기",
        "desc": "저지 중인 적을 2타일 밀쳐내고 저지를 푼다.",
        "slot": "active",
        "effect": {
          "kind": "knockback",
          "tiles": 2
        },
        "cooldownTicks": 750
      }
    }
  },
  {
    "id": "c-7018",
    "name": "시해",
    "placement": "ground",
    "cost": 11,
    "hp": 838,
    "atk": 244,
    "def": 25,
    "atkIntervalTicks": 39,
    "range": 0,
    "blockCount": 1,
    "redeployTicks": 900,
    "role": "bruiser",
    "epithet": "밤을 걷는",
    "lore": "함락된 북쪽 초소 출신. 스승을(를) 잃고, 빚을 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "시작하지.",
      "skill": "무너져라!",
      "victory": "아직 살아 있다."
    },
    "skillSet": {
      "passive": {
        "id": "p-pierce",
        "name": "꿰뚫기",
        "desc": "적 방어력을 50% 무시한다.",
        "slot": "passive",
        "effect": {
          "kind": "armorPierce",
          "ratio": 0.5
        }
      },
      "auto": {
        "id": "a-mend",
        "name": "응급 처치",
        "desc": "HP 50% 미만이 되면 200 회복 (8초 주기).",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 0.5,
          "amount": 200,
          "cooldownTicks": 240
        }
      },
      "active": {
        "id": "x-second-wind",
        "name": "재기",
        "desc": "즉시 400 회복.",
        "slot": "active",
        "effect": {
          "kind": "heal",
          "amount": 400
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7019",
    "name": "재우",
    "placement": "ground",
    "cost": 14,
    "hp": 1469,
    "atk": 87,
    "def": 40,
    "atkIntervalTicks": 45,
    "range": 0,
    "blockCount": 3,
    "redeployTicks": 900,
    "role": "blocker",
    "epithet": "잿빛",
    "lore": "무너진 동쪽 관문 출신. 고향을(를) 잃고, 빚을 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "시작하지.",
      "skill": "버텨!",
      "victory": "성은 지켜졌다."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-mend",
        "name": "응급 처치",
        "desc": "HP 50% 미만이 되면 200 회복 (8초 주기).",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 0.5,
          "amount": 200,
          "cooldownTicks": 240
        }
      },
      "active": {
        "id": "x-second-wind",
        "name": "재기",
        "desc": "즉시 400 회복.",
        "slot": "active",
        "effect": {
          "kind": "heal",
          "amount": 400
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7020",
    "name": "무온",
    "placement": "wallTop",
    "cost": 13,
    "hp": 358,
    "atk": 158,
    "def": 5,
    "atkIntervalTicks": 60,
    "range": 3,
    "blockCount": 0,
    "redeployTicks": 900,
    "aoeRadius": 1.3,
    "role": "mage",
    "epithet": "한파의",
    "lore": "함락된 북쪽 초소 출신. 이름을(를) 잃고, 돌아갈 곳이 없어 성벽에 섰다.",
    "lines": {
      "deploy": "벽 뒤로 물러서라.",
      "skill": "버텨!",
      "victory": "…다음이 또 온다."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-repel",
        "name": "밀쳐내기",
        "desc": "저지 중인 적을 2타일 밀쳐내고 저지를 푼다.",
        "slot": "active",
        "effect": {
          "kind": "knockback",
          "tiles": 2
        },
        "cooldownTicks": 750
      }
    }
  },
  {
    "id": "c-7021",
    "name": "세주",
    "placement": "ground",
    "cost": 11,
    "hp": 835,
    "atk": 248,
    "def": 25,
    "atkIntervalTicks": 39,
    "range": 0,
    "blockCount": 1,
    "redeployTicks": 900,
    "role": "bruiser",
    "epithet": "탑그림자",
    "lore": "버려진 수도원 출신. 전우을(를) 잃고, 빚을 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "자리는 내가 지킨다.",
      "skill": "지금이다!",
      "victory": "…다음이 또 온다."
    },
    "skillSet": {
      "passive": {
        "id": "p-guard",
        "name": "수호 본능",
        "desc": "저지 수 +1.",
        "slot": "passive",
        "effect": {
          "kind": "statMod",
          "blockAdd": 1
        }
      },
      "auto": {
        "id": "a-regen",
        "name": "재생",
        "desc": "3초마다 40 회복.",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 1,
          "amount": 40,
          "cooldownTicks": 90
        }
      },
      "active": {
        "id": "x-second-wind",
        "name": "재기",
        "desc": "즉시 400 회복.",
        "slot": "active",
        "effect": {
          "kind": "heal",
          "amount": 400
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7022",
    "name": "단해",
    "placement": "wallTop",
    "cost": 9,
    "hp": 459,
    "atk": 136,
    "def": 10,
    "atkIntervalTicks": 30,
    "range": 3.5,
    "blockCount": 0,
    "redeployTicks": 900,
    "role": "archer",
    "epithet": "한파의",
    "lore": "얼어붙은 나루터 출신. 고향을(를) 잃고, 괴수의 피를 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "숨죽여라.",
      "skill": "…끝을 보자.",
      "victory": "아직 살아 있다."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-mend",
        "name": "응급 처치",
        "desc": "HP 50% 미만이 되면 200 회복 (8초 주기).",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 0.5,
          "amount": 200,
          "cooldownTicks": 240
        }
      },
      "active": {
        "id": "x-second-wind",
        "name": "재기",
        "desc": "즉시 400 회복.",
        "slot": "active",
        "effect": {
          "kind": "heal",
          "amount": 400
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7023",
    "name": "은온",
    "placement": "ground",
    "cost": 14,
    "hp": 1433,
    "atk": 95,
    "def": 40,
    "atkIntervalTicks": 45,
    "range": 0,
    "blockCount": 3,
    "redeployTicks": 900,
    "role": "blocker",
    "epithet": "무너진 문의",
    "lore": "함락된 북쪽 초소 출신. 왼눈을(를) 잃고, 빚을 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "여기까지다.",
      "skill": "지금이다!",
      "victory": "아직 살아 있다."
    },
    "skillSet": {
      "passive": {
        "id": "p-guard",
        "name": "수호 본능",
        "desc": "저지 수 +1.",
        "slot": "passive",
        "effect": {
          "kind": "statMod",
          "blockAdd": 1
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-nova",
        "name": "충격파",
        "desc": "자기 주변 1.6타일에 방어 무시 250 피해.",
        "slot": "active",
        "effect": {
          "kind": "nova",
          "damage": 250,
          "radius": 1.6
        },
        "cooldownTicks": 1050
      }
    }
  },
  {
    "id": "c-7024",
    "name": "유린",
    "placement": "ground",
    "cost": 14,
    "hp": 1306,
    "atk": 89,
    "def": 40,
    "atkIntervalTicks": 45,
    "range": 0,
    "blockCount": 3,
    "redeployTicks": 900,
    "role": "blocker",
    "epithet": "침묵하는",
    "lore": "폐쇄된 갱도 출신. 가족을(를) 잃고, 돌아갈 곳이 없어 성벽에 섰다.",
    "lines": {
      "deploy": "벽 뒤로 물러서라.",
      "skill": "무너져라!",
      "victory": "아직 살아 있다."
    },
    "skillSet": {
      "passive": {
        "id": "p-pierce",
        "name": "꿰뚫기",
        "desc": "적 방어력을 50% 무시한다.",
        "slot": "passive",
        "effect": {
          "kind": "armorPierce",
          "ratio": 0.5
        }
      },
      "auto": {
        "id": "a-regen",
        "name": "재생",
        "desc": "3초마다 40 회복.",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 1,
          "amount": 40,
          "cooldownTicks": 90
        }
      },
      "active": {
        "id": "x-frenzy",
        "name": "전의 폭발",
        "desc": "6초간 공격 속도 2배.",
        "slot": "active",
        "effect": {
          "kind": "frenzy",
          "atkSpeedMul": 2,
          "durationTicks": 180
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7027",
    "name": "수우",
    "placement": "wallTop",
    "cost": 9,
    "hp": 441,
    "atk": 120,
    "def": 10,
    "atkIntervalTicks": 30,
    "range": 3.5,
    "blockCount": 0,
    "redeployTicks": 900,
    "role": "archer",
    "epithet": "녹슨 칼날의",
    "lore": "얼어붙은 나루터 출신. 전우을(를) 잃고, 괴수의 피를 갚으려 성벽에 섰다.",
    "lines": {
      "deploy": "자리는 내가 지킨다.",
      "skill": "지금이다!",
      "victory": "수고했다, 모두."
    },
    "skillSet": {
      "passive": {
        "id": "p-eagle",
        "name": "매의 눈",
        "desc": "사거리 +0.5 (원거리 전용).",
        "slot": "passive",
        "effect": {
          "kind": "statMod",
          "rangeAdd": 0.5
        }
      },
      "auto": {
        "id": "a-pulse",
        "name": "파문",
        "desc": "3회 공격마다 표적 주변에 70% 광역 피해.",
        "slot": "auto",
        "effect": {
          "kind": "aoePulse",
          "everyNAttacks": 3,
          "radius": 1.2,
          "dmgMul": 0.7
        }
      },
      "active": {
        "id": "x-second-wind",
        "name": "재기",
        "desc": "즉시 400 회복.",
        "slot": "active",
        "effect": {
          "kind": "heal",
          "amount": 400
        },
        "cooldownTicks": 900
      }
    }
  },
  {
    "id": "c-7028",
    "name": "수준",
    "placement": "wallTop",
    "cost": 9,
    "hp": 457,
    "atk": 135,
    "def": 10,
    "atkIntervalTicks": 30,
    "range": 3.5,
    "blockCount": 0,
    "redeployTicks": 900,
    "role": "archer",
    "epithet": "침묵하는",
    "lore": "재가 된 시장거리 출신. 스승을(를) 잃고, 다시는 잃지 않으려 성벽에 섰다.",
    "lines": {
      "deploy": "벽 뒤로 물러서라.",
      "skill": "버텨!",
      "victory": "성은 지켜졌다."
    },
    "skillSet": {
      "passive": {
        "id": "p-scavenge",
        "name": "전리품",
        "desc": "적 처치 시 코스트 +1.",
        "slot": "passive",
        "effect": {
          "kind": "onKillCost",
          "amount": 1
        }
      },
      "auto": {
        "id": "a-regen",
        "name": "재생",
        "desc": "3초마다 40 회복.",
        "slot": "auto",
        "effect": {
          "kind": "selfHeal",
          "thresholdRatio": 1,
          "amount": 40,
          "cooldownTicks": 90
        }
      },
      "active": {
        "id": "x-nova",
        "name": "충격파",
        "desc": "자기 주변 1.6타일에 방어 무시 250 피해.",
        "slot": "active",
        "effect": {
          "kind": "nova",
          "damage": 250,
          "radius": 1.6
        },
        "cooldownTicks": 1050
      }
    }
  }
]
