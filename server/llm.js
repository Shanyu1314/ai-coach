// LLM 编排：白名单约束 + JSON 输出 + 校验重试 + 规则兜底
import { EXERCISES, validatePlan } from './planSchema.js';
import { generateFallbackPlan } from './fallback.js';

// 压缩白名单为紧凑清单，控制 prompt 体积
const WHITELIST = EXERCISES.map(
  (e) => `${e.slug}|${e.name}|${e.primaryMuscle}|${e.equipment}${e.isStretch ? '|stretch' : ''}`
).join('\n');

const SYSTEM_PROMPT = `你是一位严谨的健身教练，为用户定制训练计划。

【动作白名单】只能从以下动作中选取（格式 slug|英文名|主肌群|器械），绝不允许编造 slug：
${WHITELIST}

【输出要求】只输出一个 JSON 对象，不要输出任何其他文字。结构：
{
  "title": "计划标题",
  "summary": "计划概述（80字内，说明编排逻辑）",
  "weeks": [{
    "week": 1,
    "focus": "本周重点",
    "days": [{
      "day": "周一", "type": "strength|cardio|rest", "name": "如 推日",
      "note": "当日注意事项（可空）",
      "exercises": [{ "slug": "push-up", "sets": "3 组 × 力竭", "rest": "90 秒", "cue": "动作要点一句话" }]
    }]
  }],
  "tips": ["全局建议，如饮食/睡眠/渐进超负荷，3~6 条"],
  "hydration": { "dailyMl": 2000, "lines": ["饮水建议 3~4 条，每条 30 字内"] },
  "sleep": { "lines": ["睡眠建议 3~4 条，每条 30 字内"] },
  "mindset": ["心态建议 3~4 条，每条 25 字内"]
}

【饮水（hydration）权威依据，必须遵守】
- 基准量按中国居民膳食指南：成年男性约 1700 ml/天，女性约 1500 ml/天；每周训练 ≥4 天加 500 ml，否则加 300 ml；dailyMl 填计算后的具体数字
- 必须提醒"少量多次、小口慢饮"，禁止鼓吹短时间大量豪饮（低钠血症风险）
- 大量出汗场景提醒补水配电解质

【睡眠（sleep）权威依据，必须遵守】
- 成人推荐 7~9 小时，强调规律作息（固定起床时间）比凑时长更重要
- 结合训练：肌肉在睡眠中恢复生长，睡眠不足直接影响训练效果

【心态（mindset）】
- 围绕"专注自己的节奏、不和他人比较、建立边界、失败无所谓"的主体性主题，结合健身场景写

【编排规则】
1. 每个力量训练日的前 3~4 个动作必须是热身（从白名单选 jumping-jack / arm-circles / bodyweight-squat / high-knees 等）
2. 每周力量训练次数 = 用户要求的天数；推/拉/腿轮转或上下肢分化；休息日 type=rest 且 exercises 为空
3. 组次用中文格式如 "3 组 × 8~12"、"3 × 45 秒"；组间休息 30 秒~2 分钟
4. 用户提到的伤病部位必须避开（如膝伤避开跳跃类和深蹲大角度）
5. 器械限制：用户没有的器械，对应动作一律不选
6. cue 必须是可执行的一句话要点（姿势/呼吸/常见错误）
7. 库外动作（如真空腹、羽毛球）用 {"custom": true, "name": "中文名", "sets": ..., "rest": ..., "cue": ...}，尽量少用
8. 周数 = 用户要求的周期周数，每周 focus 体现渐进超负荷`;

// 中转站（boostapi 等）会按 TLS 指纹拦截 Node/Python 客户端，因此用 curl 发请求
import { execFile } from 'node:child_process';

function curlPostJson(url, apiKey, payload) {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-sS', '--max-time', '170', '-X', 'POST', url,
        '-H', `Authorization: Bearer ${apiKey}`,
        '-H', 'Content-Type: application/json',
        '-d', JSON.stringify(payload),
        '-w', '\n%{http_code}'],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`curl 调用失败: ${stderr || err.message}`));
        const m = stdout.match(/\n(\d{3})$/);
        const status = m ? Number(m[1]) : 0;
        const body = m ? stdout.slice(0, m.index) : stdout;
        if (status < 200 || status >= 300) return reject(new Error(`LLM HTTP ${status}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('LLM 返回非 JSON')); }
      },
    );
  });
}

export async function generatePlan(profile) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    const { plan } = validatePlan(generateFallbackPlan(profile, '未配置大模型密钥'));
    return { plan, source: 'fallback' };
  }

  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'kimi-k2-0711-preview';
  const userMsg = `用户档案：${JSON.stringify(profile)}\n请生成 ${profile.durationWeeks || 4} 周训练计划。`;

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await curlPostJson(`${baseUrl}/chat/completions`, apiKey, {
        // 注意：不要加 response_format——该中转站在大请求 + json_object 组合下会报错
        model: attempt === 0 ? model : (process.env.LLM_MODEL_FIX || model),
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
          ...(attempt > 0
            ? [{ role: 'user', content: `上一次输出有问题：${lastError}。请修正后重新输出完整 JSON。` }]
            : []),
        ],
      });
      const text = data.choices?.[0]?.message?.content || '';
      // 从文本中提取 JSON（模型可能带 markdown 围栏）
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) throw new Error('模型未返回 JSON');
      const raw = JSON.parse(text.slice(start, end + 1));
      const { plan, errors } = validatePlan(raw);
      const fatal = errors.filter((e) => e.includes('为空'));
      const badSlugs = errors.filter((e) => e.includes('未知动作'));
      if (fatal.length > 0) {
        lastError = fatal.join('；');
        continue;
      }
      // 按唯一 slug 数判断：同一个错动作出现多次只是 1 个问题，不值得重试浪费 90 秒
      const uniqBad = [...new Set(badSlugs)];
      if (uniqBad.length > 2) {
        lastError = `使用了不存在于白名单的动作：${uniqBad.join('；')}`;
        continue;
      }
      return { plan, source: 'llm', warnings: errors };
    } catch (err) {
      lastError = String(err.message || err);
    }
  }
  // LLM 两次都失败，降级到规则引擎，绝不让用户空手而归
  const { plan } = validatePlan(generateFallbackPlan(profile, '大模型暂时不可用，已用规则引擎兜底'));
  return { plan, source: 'fallback', warnings: [`大模型生成失败（${lastError}），已用规则引擎兜底`] };
}
