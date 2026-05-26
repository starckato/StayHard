// 큐록 · features/mandatory/merge.js
// Mandatory routine ADDITIVE merge — 미래 일자 propagate 시 기존 customs 보존.
//
// 5/9 starckato 사태 (destructive propagate 가 14일 미래 customs 1개로 덮어쓰기) 의
// 재발 방지 로직. propagateMandatoryDefsAdditive 의 핵심 pure 함수 추출.
//
// 규칙:
//   1) defs 의 customs 가 mergedCustoms 로 들어가되 기존 done/fail state 는 보존
//   2) DB existing 의 customs 중 defs 에 없는 이름은 그대로 보존 (UNION)
//   3) DB existing 의 derived (custom 아닌 type) 는 그대로 보존
//
// Pure function — DOM/sb 의존성 없음. 호출자가 read-modify-write 패턴으로 사용.

/**
 * Merge new custom defs into existing mandatory list (additive).
 *
 * @param {Array} existingMandatory — DB 의 daily_logs.mandatory 현재 값
 * @param {Array} newDefs           — 호출자가 propagate 하려는 def 목록 (custom + 기타)
 * @returns {Array} mergedMandatory — 안전하게 union 된 결과
 */
export function mergeMandatoryAdditive(existingMandatory, newDefs) {
  const existing = Array.isArray(existingMandatory) ? existingMandatory : [];
  const defs = Array.isArray(newDefs) ? newDefs : [];

  // newDefs 중 type='custom' + name 있는 것만 propagate 대상
  const customDefs = defs.filter(d => d && d.type === 'custom' && d.name);

  const existingCustoms = existing.filter(m => m && m.type === 'custom');
  const existingDerived = existing.filter(m => m && m.type && m.type !== 'custom');

  const seenNames = new Set();
  const mergedCustoms = [];

  // 1) 신규 defs — 기존 done/fail state preserve
  for (const def of customDefs) {
    seenNames.add(def.name);
    const et = existingCustoms.find(m => m.name === def.name);
    mergedCustoms.push({
      type: 'custom',
      name: def.name,
      done: et?.done || false,
      fail: et?.fail || false,
      days: def.days || [0, 1, 2, 3, 4, 5, 6],
      _scoreType: def._scoreType || null,
      end_date: def.end_date || null,
    });
  }

  // 2) 이름 충돌 안 하는 기존 customs 보존 (← 핵심 fix)
  for (const ec of existingCustoms) {
    if (!seenNames.has(ec.name)) mergedCustoms.push(ec);
  }

  // 3) derived (diet/workout/todos 같은 type) 는 그대로
  return [...existingDerived, ...mergedCustoms];
}
