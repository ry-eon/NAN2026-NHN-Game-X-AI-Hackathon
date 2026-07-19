// 수록 스테이지 목록. 클라이언트 스테이지 선택과 파이프라인 일괄 검증이 공유한다.
// 수제(001, 002) + 파이프라인 출고분(GENERATED_STAGES, 봇 검증 통과만 포함).

import type { StageDef } from '../../types'
import { STAGE_001 } from './stage-001'
import { STAGE_002 } from './stage-002'
import { GENERATED_STAGES } from './generated'

export const STAGES: StageDef[] = [STAGE_001, STAGE_002, ...GENERATED_STAGES]
