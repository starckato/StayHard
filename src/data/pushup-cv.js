// Stay Hard · pushup CV data
//
// Constants for the MediaPipe Pose-based pushup rep counter.
// Pure data. No runtime state, no DOM.

export const CV_EXERCISES={
  pushup:  {joint:'elbow', downAngle:90,  upAngle:155, label:'푸쉬업',     icon:'🤸', muscle:'가슴',equip:'맨몸'},
  squat:   {joint:'knee',  downAngle:95,  upAngle:155, label:'스쿼트',     icon:'🤸', muscle:'하체',equip:'맨몸'},
  pullup:  {joint:'elbow', downAngle:75,  upAngle:150, label:'풀업',       icon:'🤸', muscle:'등',  equip:'맨몸'},
  lunge:   {joint:'knee',  downAngle:95,  upAngle:150, label:'런지',       icon:'🤸', muscle:'하체',equip:'맨몸'},
  situp:   {joint:'hip',   downAngle:60,  upAngle:120, label:'싯업',       icon:'🤸', muscle:'복근',equip:'맨몸'},
  burpee:  {joint:'knee',  downAngle:90,  upAngle:155, label:'버피',       icon:'🤸', muscle:'전신',equip:'맨몸'},
  bicep:   {joint:'elbow', downAngle:55,  upAngle:155, label:'바이셉컬',   icon:'💪', muscle:'팔',  equip:'덤벨'},
};

export const CV_LM={lShoulder:11,rShoulder:12,lElbow:13,rElbow:14,lWrist:15,rWrist:16,lHip:23,rHip:24,lKnee:25,rKnee:26,lAnkle:27,rAnkle:28};

export const CV_KO_NUMS=['','하나','둘','셋','넷','다섯','여섯','일곱','여덟','아홉','열',
  '열하나','열둘','열셋','열넷','열다섯','열여섯','열일곱','열여덟','열아홉','스물',
  '스물하나','스물둘','스물셋','스물넷','스물다섯','스물여섯','스물일곱','스물여덟','스물아홉','서른'];

export const CV_CONNECTIONS=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
