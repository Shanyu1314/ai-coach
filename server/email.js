// Resend 邮件发送：把计划渲染成 HTML 邮件（动图走站点 URL）
import { Resend } from 'resend';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function planToHtml(plan, publicUrl) {
  const base = (publicUrl || '').replace(/\/$/, '');
  const weekHtml = plan.weeks
    .map((w) => {
      const days = w.days
        .map((d) => {
          if (d.type === 'rest')
            return `<tr><td style="padding:8px 12px;color:#888">${esc(d.day)}</td><td colspan="2" style="padding:8px 12px;color:#888">休息 · ${esc(d.note || '散步放松')}</td></tr>`;
          const rows = d.exercises
            .map((ex) => {
              const img = ex.custom
                ? ''
                : `<img src="${base}/assets/gifs/${esc(ex.slug)}.gif" width="72" height="72" style="border-radius:8px;vertical-align:middle;margin-right:10px" alt="">`;
              return `<div style="display:flex;align-items:center;padding:6px 0;border-bottom:1px solid #2a2e33">
                ${img}<div><b>${esc(ex.name)}</b> <span style="color:#888;font-size:12px">${esc(ex.sets)} · 休息 ${esc(ex.rest)}</span><br>
                <span style="color:#999;font-size:12px">${esc(ex.cue)}</span></div></div>`;
            })
            .join('');
          return `<tr><td style="padding:8px 12px;white-space:nowrap;vertical-align:top"><b>${esc(d.day)}</b></td>
            <td style="padding:8px 12px;vertical-align:top"><b>${esc(d.name)}</b><br><span style="color:#999;font-size:12px">${esc(d.note)}</span></td>
            <td style="padding:8px 12px">${rows}</td></tr>`;
        })
        .join('');
      return `<h3 style="margin:24px 0 8px">第 ${w.week} 周 · ${esc(w.focus)}</h3>
        <table style="width:100%;border-collapse:collapse;background:#1a1d21;border-radius:12px;color:#e9ecef">${days}</table>`;
    })
    .join('');

  const tips = plan.tips.map((t) => `<li style="margin:4px 0">${esc(t)}</li>`).join('');

  // 四模块扩展：大水 / 大睡 / 黄毛
  const hydration = plan.hydration
    ? `<h3 style="margin:24px 0 8px">💧 大水 · 每日饮水 ${esc(plan.hydration.dailyMl)} ml</h3>
       <ul style="color:#adb5bd;font-size:14px;padding-left:20px;line-height:1.7">${plan.hydration.lines.map((l) => `<li style="margin:4px 0">${esc(l)}</li>`).join('')}</ul>`
    : '';
  const sleep = plan.sleep
    ? `<h3 style="margin:24px 0 8px">😴 大睡 · 睡眠方案</h3>
       <ul style="color:#adb5bd;font-size:14px;padding-left:20px;line-height:1.7">${plan.sleep.lines.map((l) => `<li style="margin:4px 0">${esc(l)}</li>`).join('')}</ul>`
    : '';
  const mindset = Array.isArray(plan.mindset) && plan.mindset.length
    ? `<h3 style="margin:24px 0 8px">😎 黄毛 · 心态建设</h3>
       <ul style="color:#adb5bd;font-size:14px;padding-left:20px;line-height:1.7">${plan.mindset.map((m) => `<li style="margin:4px 0">${esc(m)}</li>`).join('')}</ul>`
    : '';

  return `<div style="max-width:640px;margin:0 auto;font-family:-apple-system,'PingFang SC',sans-serif;background:#0f1114;color:#e9ecef;padding:24px;border-radius:16px">
    <h1 style="font-size:22px;margin:0 0 8px">${esc(plan.title)}</h1>
    <p style="color:#adb5bd;font-size:14px;line-height:1.7">${esc(plan.summary)}</p>
    ${weekHtml}
    <h3 style="margin:24px 0 8px">执行要点</h3>
    <ul style="color:#adb5bd;font-size:14px;padding-left:20px;line-height:1.7">${tips}</ul>
    ${hydration}
    ${sleep}
    ${mindset}
    <p style="color:#666;font-size:12px;margin-top:24px">动作图 © Bryl Lim / Everkinetic, CC BY-SA 4.0 · 本计划仅供参考，不构成医疗建议，训练中如有关节刺痛请立即停止。</p>
  </div>`;
}

export async function sendPlanEmail(to, plan) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('未配置 RESEND_API_KEY');
  const resend = new Resend(apiKey);
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const from = process.env.RESEND_FROM || 'AI 私教 <onboarding@resend.dev>';
  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    subject: `🏋️ ${plan.title}`,
    html: planToHtml(plan, publicUrl),
  });
  if (error) {
    const msg = error.message || JSON.stringify(error);
    // Resend 沙箱限制：只能发给注册邮箱，转成用户能看懂的中文提示
    if (/only send testing emails/i.test(msg)) {
      throw new Error('邮件服务还在测试期，暂时只能发到站长自己的邮箱。我们正在配置域名，很快就能给所有人发信了');
    }
    throw new Error(msg);
  }
  return data;
}
