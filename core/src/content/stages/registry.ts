// 수록 스테이지 목록. 클라이언트 스테이지 선택과 파이프라인 일괄 검증이 공유한다.
// W2 파이프라인 통과분(생성 스테이지)도 여기에 추가된다.

import type { StageDef } from '../../types'
import { STAGE_001 } from './stage-001'
import { STAGE_002 } from './stage-002'

export const STAGES: StageDef[] = [STAGE_001, STAGE_002]
