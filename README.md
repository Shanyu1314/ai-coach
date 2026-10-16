# AI 私教计划生成器

填 30 秒问卷（身高 / 体重 / 目标 / 器械 / 伤病）→ 大模型生成结构化训练计划 → 自动匹配 **302 个标准动作动图** → 一键发送到邮箱。

动作图解来自开源库 [workout-guide](https://github.com/bryllim/workout-guide)，3 帧连播成 GIF 动图。

## 架构

```
React + Vite + Tailwind + shadcn/ui（前端）
        ↓ /api/plan
Express 服务端（server/）
  ├─ planSchema.js  计划 JSON 校验 + 302 动作白名单匹配
  ├─ llm.js         大模型编排（OpenAI 兼容接口，白名单约束 + JSON 输出 + 校验重试）
  ├─ fallback.js    规则引擎兜底（无密钥 / 模型失败时仍能出计划）
  └─ email.js       Resend 邮件发送（HTML 计划 + 动图）
```

关键设计：大模型**不能自由编造动作**——prompt 内置 302 个动作的白名单（slug / 肌群 / 器械），输出后经程序化校验，未知动作直接丢弃或触发重试；库外动作走 `custom` 通道。

## 本地运行

```bash
cp .env.example .env   # 填入密钥
npm install
npm run dev            # 开发（vite middleware，支持 -- --port N）
npm run build          # 构建
npm start              # 生产模式（服务 dist/）
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` | 大模型密钥（任何 OpenAI 兼容接口）。**不配置也能跑**，自动降级为内置规则引擎 |
| `LLM_BASE_URL` / `LLM_MODEL` | 接口地址 / 模型名，默认 Moonshot Kimi |
| `RESEND_API_KEY` | [Resend](https://resend.com) 邮件密钥 |
| `RESEND_FROM` | 发件人；测试用 `onboarding@resend.dev`，生产需在 Resend 验证自有域名 |
| `PUBLIC_URL` | 站点对外地址（邮件中动图的域名） |
| `PORT` | 服务端口 |

## 部署（Ubuntu + nginx + systemd）

见 `deploy/` 目录：`ai-coach.service`（systemd 单元）、`gym.shanyu1314.top.conf`（nginx 反代示例）。

```bash
rsync -az --exclude node_modules --exclude .env dist server package*.json deploy root@<server>:/opt/ai-coach/
# 服务器上：
npm install --omit=dev && cp deploy/ai-coach.service /etc/systemd/system/
systemctl enable --now ai-coach
# nginx 配置放入 sites-enabled 后 reload；DNS 生效后 certbot --nginx -d <子域名>
```

## 许可与免责

- 代码：MIT
- 动作图解：© Bryl Lim / Everkinetic，[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)，二次分发需署名
- 生成的训练计划仅供参考，不构成医疗建议；训练中如有关节刺痛请立即停止
