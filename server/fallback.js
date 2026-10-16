// 无 LLM 密钥时的规则兜底生成器：根据档案从白名单选课表
const WARMUP = [
  { slug: 'jumping-jack', sets: '1 分钟', rest: '—', cue: '全身微微发热即可' },
  { slug: 'high-knees', sets: '30 秒 × 2', rest: '—', cue: '膝盖抬到髋部高度' },
  { slug: 'arm-circles', sets: '前后各 15 次', rest: '—', cue: '由小圈到大圈' },
  { slug: 'bodyweight-squat', sets: '15 次（慢做）', rest: '—', cue: '膝对准脚尖，屁股往后坐' },
];

const PUSH_BW = [
  { slug: 'push-up', sets: '3 组 × 力竭', rest: '90 秒', cue: '身体一条直线；手略宽于肩；屈肘约 45°' },
  { slug: 'diamond-push-up', sets: '3 组 × 力竭', rest: '90 秒', cue: '食指拇指相触成菱形；肘贴近身体两侧' },
  { slug: 'pike-push-up', sets: '3 × 6~10', rest: '90 秒', cue: '屁股抬高成倒 V；头顶对准两手之间下沉' },
  { slug: 'plank', sets: '3 × 45 秒', rest: '60 秒', cue: '肘在肩正下方；塌腰即结束该组' },
];
const PUSH_BAND = [{ slug: 'banded-face-pull', sets: '3 × 15', rest: '60 秒', cue: '拉向眉心；肩胛骨夹紧；别耸肩' }];
const PUSH_GYM = [
  { slug: 'bench-press', sets: '4 × 8~10', rest: '2 分钟', cue: '肩胛收紧；杠触胸口；手腕中立' },
  { slug: 'seated-dumbbell-press', sets: '3 × 10', rest: '90 秒', cue: '核心收紧；推到头顶正上方' },
  { slug: 'cable-fly', sets: '3 × 12', rest: '60 秒', cue: '肘微屈固定角度；顶峰夹胸 1 秒' },
];

const LEGS_BW = [
  { slug: 'bulgarian-split-squat', sets: '3 × 10 / 腿', rest: '90 秒', cue: '后脚放椅上；前膝不内扣；上身微前倾' },
  { slug: 'bodyweight-squat', sets: '4 × 15', rest: '90 秒', cue: '屁股往后坐；膝对准脚尖' },
  { slug: 'single-leg-romanian-deadlift', sets: '3 × 10 / 腿', rest: '90 秒', cue: '手扶墙保持平衡；背全程平直' },
  { slug: 'glute-bridge', sets: '3 × 15', rest: '60 秒', cue: '顶起至肩-髋-膝一条线；顶峰夹臀停 2 秒' },
  { slug: 'reverse-crunch', sets: '3 × 15', rest: '60 秒', cue: '下腹发力卷骨盆离地；别甩腿' },
];
const LEGS_BAND = [{ slug: 'banded-squat', sets: '3 × 15', rest: '90 秒', cue: '脚踩弹力带两端绕肩；屁股往后坐' }];

const PULL_BAND = [
  { slug: 'banded-row', sets: '4 × 12', rest: '60 秒', cue: '先收肩胛骨再屈肘；拉向小腹' },
  { slug: 'inverted-row', sets: '3 × 力竭', rest: '90 秒', cue: '胸口贴桌沿/低杠；脚前伸加难度' },
];
const PULL_BAR = [
  { slug: 'pull-up', sets: '5 ×（最大 - 1）', rest: '2 分钟', cue: '正握略宽于肩；下巴过杠停 1 秒；下放 3 秒' },
  { slug: 'hanging-leg-raise', sets: '4 × 8', rest: '60 秒', cue: '下腹发力；做不到就屈膝抬到 90°' },
];
const PULL_GYM = [
  { slug: 'lat-pulldown', sets: '4 × 10', rest: '90 秒', cue: '拉到锁骨；别后仰借力' },
  { slug: 'barbell-row', sets: '4 × 10', rest: '90 秒', cue: '背平直；拉向下腹' },
];

const CARDIO = [
  { slug: 'stair-climber', sets: '4~5 组 × 18 层', rest: '—', cue: '心率 120+ 有效；只上不下；膝不适立刻停' },
  { slug: 'jump-rope', sets: '10 分钟', rest: '—', cue: '前脚掌落地；手腕摇绳' },
  { slug: 'walking', sets: '40 分钟', rest: '—', cue: '休息日顺手做' },
];

const CN_DAY = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function injuryFilter(exs, injuries) {
  if (!injuries) return exs;
  const t = injuries.toLowerCase();
  let out = exs;
  if (t.includes('膝')) out = out.filter((e) => !['jump-rope', 'jumping-jack', 'high-knees', 'stair-climber'].includes(e.slug));
  if (t.includes('肩')) out = out.filter((e) => !['pike-push-up', 'seated-dumbbell-press'].includes(e.slug));
  if (t.includes('腰')) out = out.filter((e) => !['barbell-row'].includes(e.slug));
  return out;
}

export function generateFallbackPlan(profile, reason = '') {
  const hasBand = (profile.equipment || []).includes('弹力带');
  const hasBar = (profile.equipment || []).includes('单杠');
  const hasGym = (profile.equipment || []).includes('健身房');
  const goal = profile.goal || '薄肌塑形';
  const daysPerWeek = Math.min(Math.max(Number(profile.daysPerWeek) || 3, 2), 6);
  const weeks = Math.min(Math.max(Number(profile.durationWeeks) || 4, 1), 12);

  let push = hasGym ? PUSH_GYM : [...PUSH_BW, ...(hasBand ? PUSH_BAND : [])];
  let legs = [...LEGS_BW, ...(hasBand ? LEGS_BAND.slice(0, 1) : [])];
  let pull = hasGym ? PULL_GYM : [...(hasBar ? PULL_BAR : []), ...PULL_BAND];
  push = injuryFilter(push, profile.injuries);
  legs = injuryFilter(legs, profile.injuries);
  pull = injuryFilter(pull, profile.injuries);
  const cardio = injuryFilter(CARDIO, profile.injuries);

  // 力量日模板轮转：推 → 腿 → 拉
  const templates = [
    { name: '推日（胸肩三头）', exs: push },
    { name: '下肢日（腿臀）', exs: legs },
    { name: '拉日（背二头）', exs: pull.length ? pull : push },
  ];
  const strengthDays = goal === '减脂' ? daysPerWeek - 1 : daysPerWeek;
  const cardioDays = goal === '减脂' ? 2 : 1;

  const days = [];
  let ti = 0;
  for (let i = 0; i < 7 && days.filter((d) => d.type !== 'rest').length < daysPerWeek + cardioDays; i++) {
    const isStrength = days.filter((d) => d.type === 'strength').length < strengthDays && i % 2 === 0;
    if (isStrength) {
      const t = templates[ti++ % templates.length];
      days.push({
        day: CN_DAY[i], type: 'strength', name: t.name,
        exercises: [...WARMUP, ...t.exs],
        note: '组间休息严格执行；状态差就减一组，不要硬撑',
      });
    } else if (days.filter((d) => d.type === 'cardio').length < cardioDays) {
      days.push({
        day: CN_DAY[i], type: 'cardio', name: '有氧日',
        exercises: cardio.slice(0, 2),
        note: '力量日前后 24 小时避免高强度腿部有氧',
      });
    } else {
      days.push({ day: CN_DAY[i], type: 'rest', name: '休息日', exercises: [], note: '散步 40 分钟 + 拉伸放松' });
    }
  }
  while (days.length < 7) {
    days.push({ day: CN_DAY[days.length], type: 'rest', name: '休息日', exercises: [], note: '' });
  }

  const weekPlans = [];
  for (let w = 1; w <= weeks; w++) {
    weekPlans.push({
      week: w,
      focus: w === 1 ? '动作学习期：宁轻勿假，先把姿势做对' : w <= weeks / 2 ? '容量提升期：每个动作尝试多完成 1~2 次' : '强度期：可升级更难变式或加负重',
      days: JSON.parse(JSON.stringify(days)),
    });
  }

  // 大水：膳食指南基准（男 1700ml / 女 1500ml）+ 训练补水
  const baseWater = profile.gender === '女' ? 1500 : 1700;
  const waterBonus = daysPerWeek >= 4 ? 500 : 300;

  return {
    title: `${profile.nickname || '我的'}${goal}计划（${weeks} 周）`,
    summary: `根据档案（${profile.age || '?'} 岁 / ${profile.height || '?'}cm / ${profile.weight || '?'}kg）生成：每周 ${daysPerWeek} 次力量${goal === '减脂' ? ' + 2 次有氧' : ''}，每次约 ${profile.minutesPerSession || 30} 分钟。本计划由内置规则引擎生成${reason ? `（${reason}）` : ''}。`,
    weeks: weekPlans,
    hydration: {
      dailyMl: baseWater + waterBonus,
      lines: [
        `基准 ${baseWater} ml（膳食指南）+ 训练补水 ${waterBonus} ml`,
        '少量多次、小口慢饮，拒绝短时间大瓶豪饮（低钠血症风险）',
        '起床 300~500 ml，训练前后各 300 ml，上下午各补一轮',
        '大量出汗时补水要配电解质，别只灌纯水',
      ],
    },
    sleep: {
      lines: [
        '睡够 7~9 小时，稳住生物钟比硬凑 8 小时更重要',
        '先固定起床时间，入睡时间自然前移',
        '23:00 前上床，睡前 1 小时放下手机',
        '肌肉在睡眠中生长：睡不够 = 白练一半',
      ],
    },
    mindset: [
      '只和上周的自己比，别人的重量与你无关',
      '训练时间是神圣的，不让琐事随便侵占',
      '这组没完成，下一组再来——失败无所谓',
      '健身是为了成为更好的自己，不是为别人眼光',
    ],
    tips: [
      '关节疼 = 动作错，肌肉酸 = 正常；关节刺痛立刻停',
      '蛋白质每天每公斤体重 1.6~2 g',
      '每周固定时间称重测腰围，看趋势不看单日',
      '23:30 前睡觉，睡眠是最便宜的增肌剂',
    ],
  };
}
