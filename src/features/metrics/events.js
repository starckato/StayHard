// 큐록 · metric event key 사전
//
// SERVICE_EVALUATION.md §7 의 M1–M10 지표 측정을 위한 이벤트 키.
// 서버 `metric_events.event_key` 가 이 문자열을 신뢰하므로 오타 방지용 상수.

export const EVT = {
  // Activation (M1, M2)
  ONBOARDING_STARTED:          'onboarding_started',
  ONBOARDING_COMPLETED:        'onboarding_completed',
  FIRST_CUBE_EARNED:           'first_cube_earned',    // M1
  FIRST_CUBE_SKIPPED:          'first_cube_skipped',
  PERFECT_DAY_ACHIEVED:        'perfect_day_achieved', // M8

  // Notifications (M3)
  OPT_IN_REQUESTED_ONBOARDING: 'opt_in_requested_onboarding',
  OPT_IN_REQUESTED_D3:         'opt_in_requested_d3',
  OPT_IN_RESULT:               'opt_in_result',

  // Friends (M4, M5)
  FRIEND_CODE_VIEWED:          'friend_code_viewed',
  FRIEND_CODE_SHARED:          'friend_code_shared',
  FRIEND_CODE_ENTERED:         'friend_code_entered',
  FRIEND_ADDED:                'friend_added',
  NUDGE_SENT:                  'nudge_sent',
  NUDGE_RECEIVED:              'nudge_received',

  // Retention (M6, M7)
  RETURNER_GRACE_ACTIVATED:    'returner_grace_activated',
  EXEMPT_USED:                 'exempt_used',

  // Engagement (M9, M10)
  STATUS_BAND_DWELL:           'status_band_dwell',
  TAB_VISIT:                   'tab_visit',
};
