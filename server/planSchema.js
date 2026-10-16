// 训练计划 JSON Schema 校验 + 白名单匹配
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXERCISES = JSON.parse(
  readFileSync(path.join(__dirname, 'data/exercises.json'), 'utf-8')
);
const slugSet = new Set(EXERCISES.map((e) => e.slug));

export function getExercise(slug) {
  return EXERCISES.find((e) => e.slug === slug) || null;
}

// 校验并清洗模型输出的计划；返回 { plan, errors }
export function validatePlan(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { plan: null, errors: ['计划不是 JSON 对象'] };

  // 紧凑输出兼容：模型可输出 templateWeek（一周完整模板）+ weeksMeta（每周 focus），
  // 服务端展开为完整 weeks，模型输出量减少约 70%，生成时间从 3 分钟压到 1 分钟内
  if ((!Array.isArray(raw.weeks) || raw.weeks.length === 0) && raw.templateWeek && Array.isArray(raw.templateWeek.days)) {
    const metas = Array.isArray(raw.weeksMeta) ? raw.weeksMeta : [];
    const n = Math.max(metas.length, Number(raw.durationWeeks) || 1, 1);
    raw.weeks = Array.from({ length: n }, (_, i) => ({
      week: i + 1,
      focus: String(metas[i]?.focus || '').slice(0, 100),
      days: raw.templateWeek.days,
    }));
  }

  const plan = {
    title: String(raw.title || '我的专属训练计划').slice(0, 60),
    summary: String(raw.summary || '').slice(0, 500),
    tips: Array.isArray(raw.tips) ? raw.tips.slice(0, 8).map((t) => String(t).slice(0, 200)) : [],
    // 四模块扩展：大水（饮水）/ 大睡（睡眠）/ 黄毛（心态）
    hydration:
      raw.hydration && typeof raw.hydration === 'object'
        ? {
            dailyMl: Math.min(Math.max(Number(raw.hydration.dailyMl) || 0, 0), 5000),
            lines: Array.isArray(raw.hydration.lines)
              ? raw.hydration.lines.slice(0, 6).map((l) => String(l).slice(0, 150))
              : [],
          }
        : null,
    sleep:
      raw.sleep && typeof raw.sleep === 'object' && Array.isArray(raw.sleep.lines)
        ? { lines: raw.sleep.lines.slice(0, 6).map((l) => String(l).slice(0, 150)) }
        : null,
    mindset: Array.isArray(raw.mindset) ? raw.mindset.slice(0, 6).map((m) => String(m).slice(0, 150)) : [],
    weeks: [],
  };

  const weeks = Array.isArray(raw.weeks) ? raw.weeks.slice(0, 12) : [];
  if (weeks.length === 0) errors.push('weeks 为空');

  for (const [wi, w] of weeks.entries()) {
    const week = { week: Number(w.week) || wi + 1, focus: String(w.focus || '').slice(0, 100), days: [] };
    const days = Array.isArray(w.days) ? w.days.slice(0, 7) : [];
    for (const d of days) {
      const day = {
        day: String(d.day || '').slice(0, 10),
        type: ['strength', 'cardio', 'rest'].includes(d.type) ? d.type : 'strength',
        name: String(d.name || '').slice(0, 30),
        note: String(d.note || '').slice(0, 200),
        exercises: [],
      };
      const exs = Array.isArray(d.exercises) ? d.exercises.slice(0, 10) : [];
      for (const ex of exs) {
        const item = {
          sets: String(ex.sets || '3 组 × 10').slice(0, 30),
          rest: String(ex.rest || '60 秒').slice(0, 20),
          cue: String(ex.cue || '').slice(0, 200),
        };
        if (ex.custom === true) {
          item.custom = true;
          item.name = String(ex.name || '自定义动作').slice(0, 30);
        } else {
          let slug = String(ex.slug || '');
          if (!slugSet.has(slug)) {
            // 容错：模型可能给 slug 加器械前缀，如 banded-tricep-pushdown → tricep-pushdown
            const stripped = slug.replace(/^(banded|band|cable|barbell|dumbbell|machine|weighted)-/, '');
            if (slugSet.has(stripped)) slug = stripped;
          }
          if (!slugSet.has(slug)) {
            errors.push(`未知动作 slug: ${slug || '(空)'}`);
            continue; // 丢弃未知动作
          }
          item.slug = slug;
          const meta = getExercise(slug);
          item.name = meta.name;
          item.muscle = meta.primaryMuscle;
        }
        day.exercises.push(item);
      }
      if (day.type !== 'rest' && day.exercises.length === 0) {
        errors.push(`${day.day || '?'} ${day.name || ''} 没有有效动作`);
      }
      week.days.push(day);
    }
    plan.weeks.push(week);
  }
  return { plan, errors };
}
