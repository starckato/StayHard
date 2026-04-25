// QROK · muscle activation data + helpers
//
// Pure data maps and helpers. No state. No DOM.
//   - MUSCLE_MAP[exerciseName] = {muscleKey: percent, ...}
//   - MUSCLE_SVG_MAP[muscleKey] = [svgPathId, ...]  (anatomy SVG mapping)
//   - MUSCLE_LABELS[muscleKey] = Korean label
//   - heatColor(t) → rgb string for heatmap intensity [0,1]

export const MUSCLE_MAP={
  // 가슴
  '벤치프레스':{chest:70,front_delt:15,triceps:15},'인클라인 벤치프레스':{chest:60,front_delt:25,triceps:15},'디클라인 벤치프레스':{chest:75,front_delt:10,triceps:15},
  '덤벨 벤치프레스':{chest:70,front_delt:15,triceps:15},'인클라인 덤벨 프레스':{chest:60,front_delt:25,triceps:15},'디클라인 덤벨 프레스':{chest:75,front_delt:10,triceps:15},
  '덤벨 플라이':{chest:85,front_delt:15},'인클라인 덤벨 플라이':{chest:75,front_delt:25},'디클라인 덤벨 플라이':{chest:85,front_delt:15},
  '케이블 크로스오버':{chest:80,front_delt:20},'하이 케이블 크로스오버':{chest:80,front_delt:20},'로우 케이블 크로스오버':{chest:80,front_delt:20},'케이블 체스트 프레스':{chest:70,front_delt:15,triceps:15},
  '펙덱 플라이':{chest:90,front_delt:10},'머신 체스트 프레스':{chest:70,front_delt:15,triceps:15},'스미스 머신 벤치프레스':{chest:70,front_delt:15,triceps:15},
  '슬로우 푸쉬업':{chest:60,front_delt:15,triceps:25},'스미스 인클라인 프레스':{chest:60,front_delt:25,triceps:15},'플라이 머신 (단측)':{chest:90,front_delt:10},
  '푸쉬업':{chest:60,front_delt:15,triceps:25},'인클라인 푸쉬업':{chest:55,front_delt:20,triceps:25},'디클라인 푸쉬업':{chest:65,front_delt:10,triceps:25},
  '와이드 푸쉬업':{chest:70,front_delt:15,triceps:15},'다이아몬드 푸쉬업':{chest:40,triceps:45,front_delt:15},'아처 푸쉬업':{chest:65,front_delt:15,triceps:20},
  '플레이트 프레스':{chest:75,front_delt:15,triceps:10},
  '디클라인 머신 프레스':{chest:75,front_delt:10,triceps:15},
  // 등
  '데드리프트':{lower_back:30,glutes:25,hamstrings:20,upper_back:10,traps:10,forearms:5},'루마니안 데드리프트':{hamstrings:40,glutes:30,lower_back:25,forearms:5},
  '스모 데드리프트':{glutes:30,quads:20,hamstrings:20,lower_back:15,upper_back:10,forearms:5},'랙 풀':{upper_back:30,traps:25,lower_back:20,glutes:15,forearms:10},
  '바벨 로우':{lats:40,upper_back:25,rear_delt:10,biceps:15,forearms:10},'펜들레이 로우':{lats:40,upper_back:30,rear_delt:10,biceps:15,forearms:5},
  '굿모닝':{hamstrings:40,lower_back:35,glutes:25},'덤벨 로우':{lats:45,upper_back:25,rear_delt:10,biceps:15,forearms:5},'원암 덤벨 로우':{lats:45,upper_back:25,rear_delt:10,biceps:15,forearms:5},
  '리버스 플라이':{rear_delt:50,upper_back:30,traps:20},'케이블 로우':{lats:40,upper_back:30,biceps:20,forearms:10},'시티드 케이블 로우':{lats:40,upper_back:30,biceps:20,forearms:10},
  '케이블 시티드 로우':{lats:40,upper_back:30,biceps:20,forearms:10},'어시스트 풀업':{lats:45,upper_back:20,biceps:25,forearms:10},'페이스풀':{rear_delt:45,upper_back:30,traps:25},
  '랫풀다운':{lats:50,upper_back:20,biceps:20,forearms:10},'와이드 랫풀다운':{lats:55,upper_back:25,biceps:15,forearms:5},'리버스 그립 랫풀다운':{lats:45,biceps:30,upper_back:20,forearms:5},
  '티바 로우':{lats:40,upper_back:30,biceps:15,rear_delt:10,forearms:5},'머신 로우':{lats:40,upper_back:30,biceps:20,rear_delt:10},'리버스 펙덱':{rear_delt:50,upper_back:30,traps:20},
  '백 익스텐션':{lower_back:50,glutes:30,hamstrings:20},'풀업':{lats:45,upper_back:20,biceps:25,forearms:10},'친업':{biceps:35,lats:40,upper_back:15,forearms:10},
  '와이드 풀업':{lats:55,upper_back:25,biceps:15,forearms:5},'클로즈 풀업':{lats:40,biceps:35,upper_back:15,forearms:10},'슈퍼맨':{lower_back:50,glutes:30,hamstrings:20},'시티드 로우 머신':{lats:40,upper_back:30,biceps:20,rear_delt:10},'스트레이트 암 풀다운':{lats:60,upper_back:20,triceps:10,abs:10},'덤벨 풀오버':{lats:45,chest:30,triceps:15,abs:10},
  // 하체
  '스쿼트':{quads:45,glutes:30,hamstrings:15,lower_back:10},'프론트 스쿼트':{quads:60,glutes:20,abs:10,lower_back:10},'박스 스쿼트':{quads:40,glutes:35,hamstrings:20,lower_back:5},
  '힙 쓰러스트':{glutes:65,hamstrings:25,lower_back:10},'고블렛 스쿼트':{quads:50,glutes:30,abs:10,forearms:10},'런지':{quads:40,glutes:35,hamstrings:20,calves:5},
  '워킹 런지':{quads:40,glutes:35,hamstrings:20,calves:5},'리버스 런지':{glutes:40,quads:35,hamstrings:20,calves:5},'불가리안 스플릿 스쿼트':{quads:40,glutes:35,hamstrings:20,calves:5},
  '스텝업':{quads:45,glutes:35,hamstrings:15,calves:5},'케이블 킥백':{glutes:70,hamstrings:30},'레그 프레스':{quads:50,glutes:30,hamstrings:15,calves:5},
  '핵 스쿼트':{quads:55,glutes:25,hamstrings:15,calves:5},'스미스 스쿼트':{quads:45,glutes:30,hamstrings:20,lower_back:5},'레그 익스텐션':{quads:100},
  '레그 컬':{hamstrings:85,calves:15},'시티드 레그 컬':{hamstrings:90,calves:10},'스탠딩 레그 컬':{hamstrings:85,calves:15},
  '힙 어브덕션':{glutes:70,hip_flexors:30},'힙 어덕션':{hip_flexors:60,glutes:40},
  '카프 레이즈':{calves:100},'스탠딩 카프 레이즈':{calves:100},'시티드 카프 레이즈':{calves:100},
  '글루트 브릿지':{glutes:70,hamstrings:20,lower_back:10},'점프 스쿼트':{quads:45,glutes:30,hamstrings:15,calves:10},'덤벨 카프 레이즈':{calves:100},'바벨 런지':{quads:40,glutes:35,hamstrings:20,calves:5},'싱글 레그 프레스':{quads:50,glutes:30,hamstrings:15,calves:5},'레그 프레스 (와이드)':{quads:40,glutes:30,hamstrings:20,hip_flexors:10},
  // 어깨
  '오버헤드 프레스':{front_delt:40,mid_delt:30,triceps:20,traps:10},'업라이트 로우':{mid_delt:40,traps:35,front_delt:15,biceps:10},'슈러그':{traps:90,mid_delt:10},
  '덤벨 숄더 프레스':{front_delt:40,mid_delt:30,triceps:20,traps:10},'스탠딩 덤벨 숄더 프레스':{front_delt:40,mid_delt:30,triceps:20,abs:10},
  '리버스 팩덱 플라이':{rear_delt:55,upper_back:25,traps:20},'아놀드 프레스':{front_delt:35,mid_delt:35,triceps:20,traps:10},
  '레터럴 레이즈':{mid_delt:80,front_delt:10,traps:10},'프론트 레이즈':{front_delt:80,mid_delt:10,chest:10},'리어 델트 플라이':{rear_delt:60,upper_back:25,traps:15},
  '덤벨 업라이트 로우':{mid_delt:40,traps:35,front_delt:15,biceps:10},'덤벨 슈러그':{traps:90,mid_delt:10},
  '케이블 레터럴 레이즈':{mid_delt:80,front_delt:10,traps:10},'케이블 리어 델트 플라이':{rear_delt:60,upper_back:25,traps:15},
  '스미스 숄더 프레스':{front_delt:40,mid_delt:30,triceps:20,traps:10},'머신 레터럴 레이즈':{mid_delt:85,traps:15},'리버스 펙덱 (어깨)':{rear_delt:55,upper_back:25,traps:20},
  '플레이트 프론트 레이즈':{front_delt:80,mid_delt:10,chest:10},'덤벨 Y레이즈':{mid_delt:40,rear_delt:30,traps:30},'케이블 프론트 레이즈':{front_delt:80,mid_delt:10,chest:10},'머신 숄더 프레스':{front_delt:40,mid_delt:30,triceps:20,traps:10},
  // 팔
  '바벨 컬':{biceps:80,forearms:20},'리버스 컬':{forearms:60,biceps:40},'스컬 크러셔':{triceps:85,chest:10,front_delt:5},'클로즈그립 벤치프레스':{triceps:60,chest:30,front_delt:10},
  '덤벨 컬':{biceps:85,forearms:15},'해머 컬':{biceps:50,forearms:50},'컨센트레이션 컬':{biceps:90,forearms:10},
  '오버헤드 트라이셉스 익스텐션':{triceps:90,front_delt:10},'덤벨 트라이셉스 킥백':{triceps:90,rear_delt:10},
  '케이블 컬':{biceps:85,forearms:15},'트라이셉스 푸쉬다운':{triceps:90,forearms:10},'케이블 푸쉬다운':{triceps:90,forearms:10},'케이블 킥백 (팔)':{triceps:90,rear_delt:10},
  '프리처 컬':{biceps:90,forearms:10},'딥스':{triceps:45,chest:35,front_delt:20},'인클라인 덤벨 컬':{biceps:85,forearms:15},'오버헤드 케이블 컬':{biceps:80,forearms:20},'리버스 그립 푸쉬다운':{triceps:85,forearms:15},'EZ바 컬':{biceps:80,forearms:20},'리스트 컬':{forearms:100},
  // 복근
  '크런치':{abs:80,obliques:20},'싯업':{abs:60,hip_flexors:30,obliques:10},'레그 레이즈':{abs:50,hip_flexors:40,obliques:10},
  '행잉 레그 레이즈':{abs:55,hip_flexors:35,obliques:10},'행잉 니업':{abs:60,hip_flexors:30,obliques:10},'플랭크':{abs:40,obliques:20,lower_back:20,front_delt:10,glutes:10},
  '사이드 플랭크':{obliques:60,abs:20,hip_flexors:10,mid_delt:10},'러시안 트위스트':{obliques:60,abs:30,hip_flexors:10},'바이시클 크런치':{abs:40,obliques:50,hip_flexors:10},
  'V업':{abs:60,hip_flexors:30,obliques:10},'케이블 크런치':{abs:80,obliques:20},'앱 롤아웃':{abs:60,obliques:15,lower_back:15,front_delt:10},'토 터치':{abs:80,hip_flexors:20},'데드 버그':{abs:50,hip_flexors:30,obliques:20},'힐 터치':{obliques:70,abs:30},
  // 전신
  '버피':{quads:25,chest:20,front_delt:15,triceps:10,abs:15,glutes:15},'마운틴 클라이머':{abs:30,hip_flexors:25,quads:20,front_delt:15,glutes:10},
  '클린':{quads:25,glutes:20,hamstrings:15,traps:15,front_delt:10,upper_back:10,forearms:5},'클린 앤 프레스':{quads:20,glutes:15,front_delt:20,traps:15,triceps:10,hamstrings:10,upper_back:10},
  '스내치':{quads:20,glutes:20,hamstrings:15,traps:15,front_delt:15,upper_back:10,forearms:5},'쓰러스터':{quads:30,glutes:20,front_delt:20,triceps:15,abs:10,hamstrings:5},
  '케틀벨 스윙':{glutes:35,hamstrings:25,lower_back:20,abs:10,front_delt:10},
  '터키시 겟업':{abs:25,front_delt:25,glutes:20,quads:15,obliques:15},'파머스 워크':{forearms:40,traps:25,abs:20,glutes:15},'박스 점프':{quads:40,glutes:30,calves:20,hamstrings:10}
};

export const MUSCLE_SVG_MAP={
  chest:['pectoralis_major_l','pectoralis_major_r'],
  upper_back:['latissimus_dorsi_l','latissimus_dorsi_r','infraspinatus_l','infraspinatus_r'],
  lats:['latissimus_dorsi_l','latissimus_dorsi_r'],
  traps:['trapezius_upper_l','trapezius_upper_r','trapezius_middle_l','trapezius_middle_r','trapezius_lower_l','trapezius_lower_r'],
  front_delt:['anterior_deltoid_l','anterior_deltoid_r'],
  mid_delt:['lateral_deltoid_l','lateral_deltoid_r'],
  rear_delt:['posterior_deltoid_l','posterior_deltoid_r'],
  biceps:['biceps_brachii_caput_longum_l','biceps_brachii_caput_longum_r','biceps_brachii_caput_breve_l','biceps_brachii_caput_breve_r'],
  triceps:['triceps_brachii_caput_laterale_l','triceps_brachii_caput_laterale_r','triceps_brachii_caput_longum_l','triceps_brachii_caput_longum_r','triceps_brachii_caput_mediale_l','triceps_brachii_caput_mediale_r'],
  forearms:['brachioradialis_l','brachioradialis_r','flexor_carpi_radialis_l','flexor_carpi_radialis_r','palmaris_longus_l','palmaris_longus_r','pronator_teres_l','pronator_teres_r','extensor_carpi_radialis_longus_l','extensor_carpi_radialis_longus_r','extensor_digitorum_l','extensor_digitorum_r','extensor_carpi_ulnaris_l','extensor_carpi_ulnaris_r','flexor_carpi_ulnaris_l','flexor_carpi_ulnaris_r'],
  glutes:['gluteus_maximus_l','gluteus_maximus_r','gluteus_medius_1_l','gluteus_medius_1_r','gluteus_medius_2_l','gluteus_medius_2_r'],
  quads:['rectus_femoris_l','rectus_femoris_r','vastus_lateralis_l','vastus_lateralis_r','vastus_medialis_l','vastus_medialis_r'],
  hamstrings:['biceps_femoris_l','biceps_femoris_r','semitendinosus_l','semitendinosus_r','semimembranosus_1_l','semimembranosus_1_r','semimembranosus_2_l','semimembranosus_2_r'],
  calves:['gastrocnemius_l','gastrocnemius_r'],
  abs:['rectus_abdominis_1','rectus_abdominis_2_l','rectus_abdominis_2_r','rectus_abdominis_3_l','rectus_abdominis_3_r','rectus_abdominis_4_l','rectus_abdominis_4_r'],
  obliques:['external_oblique_1_l','external_oblique_1_r','external_oblique_2_l','external_oblique_2_r','external_oblique_3_l','external_oblique_3_r','external_oblique_4_l','external_oblique_4_r','external_oblique_5_l','external_oblique_5_r','external_oblique_6_l','external_oblique_6_r','external_oblique_7_l','external_oblique_7_r','external_oblique_8_l','external_oblique_8_r'],
  lower_back:['latissimus_dorsi_l','latissimus_dorsi_r'],
  hip_flexors:['pectineus_l','pectineus_r','adductor_longus_l','adductor_longus_r','gracilis_l','gracilis_r','sartoris_l','sartoris_r']
};
export const MUSCLE_LABELS={chest:'가슴',upper_back:'상부 등',lats:'광배근',traps:'승모근',front_delt:'전면 삼각근',mid_delt:'측면 삼각근',rear_delt:'후면 삼각근',biceps:'이두근',triceps:'삼두근',forearms:'전완근',glutes:'둔근',quads:'대퇴사두',hamstrings:'햄스트링',calves:'종아리',abs:'복근',obliques:'복사근',lower_back:'하부 등',hip_flexors:'고관절 굴곡근'};

export function heatColor(t){
  const r=Math.round(30+(190-30)*Math.pow(t,0.6));
  const g=Math.round(22+(20-22)*t);
  const b=Math.round(25+(18-25)*t);
  return `rgb(${r},${g},${b})`;
}
