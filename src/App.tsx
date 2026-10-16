import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Toaster, toast } from 'sonner'
import { Dumbbell, History, Loader2, LogIn, LogOut, Mail, RotateCcw, Sparkles } from 'lucide-react'
import { MotionScrub } from '@/components/MotionScrub'

type PlanExercise = { slug?: string; custom?: boolean; name: string; muscle?: string; sets: string; rest: string; cue: string }
type PlanDay = { day: string; type: 'strength' | 'cardio' | 'rest'; name: string; note: string; exercises: PlanExercise[] }
type PlanWeek = { week: number; focus: string; days: PlanDay[] }
type Plan = {
  title: string; summary: string; tips: string[]; weeks: PlanWeek[]
  hydration?: { dailyMl: number; lines: string[] } | null
  sleep?: { lines: string[] } | null
  mindset?: string[]
}

const EQUIPMENT_OPTIONS = ['徒手', '弹力带', '哑铃', '单杠', '健身房']
const GOALS = ['薄肌塑形', '增肌', '减脂', '体能提升', '搏击体能']

const TYPE_STYLE: Record<string, { label: string; cls: string }> = {
  strength: { label: '力量', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  cardio: { label: '有氧', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  rest: { label: '休息', cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' },
}

export default function App() {
  const [step, setStep] = useState<'form' | 'loading' | 'plan'>('form')
  const [profile, setProfile] = useState({
    nickname: '', gender: '男', age: '', height: '', weight: '',
    goal: '薄肌塑形', equipment: ['徒手'] as string[],
    daysPerWeek: '3', minutesPerSession: '30', durationWeeks: '4',
    injuries: '', note: '',
  })
  const [plan, setPlan] = useState<Plan | null>(null)
  const [source, setSource] = useState('')
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [module, setModule] = useState<'boji' | 'dashui' | 'dashui2' | 'huangmao'>('boji')

  // ---------- 登录态 ----------
  const [token, setToken] = useState(() => localStorage.getItem('ai_coach_token') || '')
  const [user, setUser] = useState<{ id: number; email: string; nickname: string } | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [authBusy, setAuthBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [myPlans, setMyPlans] = useState<{ id: number; title: string; source: string; created_at: string }[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {}) as Record<string, string>

  useEffect(() => {
    if (!token) return
    fetch('/api/me', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => { if (d.user) setUser(d.user); else { setToken(''); localStorage.removeItem('ai_coach_token') } })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  async function sendCode() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) { toast.error('邮箱格式不正确'); return }
    setAuthBusy(true)
    try {
      const r = await fetch('/api/auth/code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authEmail }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '发送失败')
      setCodeSent(true)
      setCountdown(60)
      toast.success('验证码已发送，请查收（可能在垃圾邮件里）')
    } catch (e) { toast.error(String((e as Error).message || e)) } finally { setAuthBusy(false) }
  }

  async function login() {
    setAuthBusy(true)
    try {
      const r = await fetch('/api/auth/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, code: authCode }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '登录失败')
      setToken(d.token)
      localStorage.setItem('ai_coach_token', d.token)
      setUser(d.user)
      setAuthOpen(false)
      toast.success(`登录成功，欢迎回来 ${d.user.nickname || d.user.email}`)
    } catch (e) { toast.error(String((e as Error).message || e)) } finally { setAuthBusy(false) }
  }

  async function doLogout() {
    await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => {})
    setToken(''); setUser(null); localStorage.removeItem('ai_coach_token')
    toast.success('已退出登录')
  }

  async function openHistory() {
    const r = await fetch('/api/me/plans', { headers: authHeaders() })
    const d = await r.json()
    if (!r.ok) { toast.error(d.error || '加载失败'); return }
    setMyPlans(d.plans)
    setHistoryOpen(true)
  }

  async function loadPlan(id: number) {
    const r = await fetch(`/api/me/plans/${id}`, { headers: authHeaders() })
    const d = await r.json()
    if (!r.ok) { toast.error(d.error || '加载失败'); return }
    setPlan(d.plan)
    setSource(d.source)
    setSaved(true)
    setHistoryOpen(false)
    setStep('plan')
  }

  // 平台四模块 = 四个梗：薄肌=训练、大水=饮水、大睡=睡眠、黄毛=心态
  const MODULES = [
    { key: 'boji', label: '薄肌', sub: '训练' },
    { key: 'dashui', label: '大水', sub: '饮水' },
    { key: 'dashui2', label: '大睡', sub: '睡眠' },
    { key: 'huangmao', label: '黄毛', sub: '心态' },
  ] as const

  const toggleEquipment = (e: string) =>
    setProfile((p) => ({
      ...p,
      equipment: p.equipment.includes(e) ? p.equipment.filter((x) => x !== e) : [...p.equipment, e],
    }))

  const [progress, setProgress] = useState<string[]>([])

  async function generate() {
    setStep('loading')
    setProgress(['正在连接教练…'])
    try {
      const resp = await fetch('/api/plan/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          ...profile,
          age: Number(profile.age) || undefined,
          height: Number(profile.height) || undefined,
          weight: Number(profile.weight) || undefined,
          daysPerWeek: Number(profile.daysPerWeek),
          minutesPerSession: Number(profile.minutesPerSession),
          durationWeeks: Number(profile.durationWeeks),
        }),
      })
      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}))
        if (data.needLogin) { setAuthOpen(true) }
        throw new Error(data.error || '生成失败')
      }
      // 逐行解析 SSE 流：stage 事件更新进度，result 事件给出最终计划
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let final: { plan: Plan; source: string; saved?: boolean } | null = null
      let streamError = ''
      let streamNeedLogin = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const chunks = buf.split('\n\n')
        buf = chunks.pop() || ''
        for (const chunk of chunks) {
          const event = chunk.match(/^event: (\w+)/m)?.[1]
          const dataLine = chunk.match(/^data: (.*)$/m)?.[1]
          if (!event || !dataLine) continue
          const payload = JSON.parse(dataLine)
          if (event === 'stage') setProgress((p) => [...p, payload.text])
          else if (event === 'result') final = payload
          else if (event === 'error') { streamError = payload.error; streamNeedLogin = !!payload.needLogin }
        }
      }
      if (streamError) {
        if (streamNeedLogin) setAuthOpen(true)
        throw new Error(streamError)
      }
      if (!final) throw new Error('生成中断，请重试')
      setPlan(final.plan)
      setSource(final.source)
      setSaved(!!final.saved)
      setStep('plan')
    } catch (err) {
      toast.error(String(err))
      setStep('form')
    }
  }

  async function sendEmail() {
    if (!plan) return
    setSending(true)
    try {
      const resp = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email, plan }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '发送失败')
      toast.success('计划已发送，请查收邮箱（可能在垃圾邮件里）')
    } catch (err) {
      toast.error(String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1114] text-zinc-100">
      <Toaster theme="dark" position="top-center" />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-8 text-center">
          {/* 右上角登录区 */}
          <div className="mb-3 flex justify-end">
            {user ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-green-500/10 border border-green-500/30 px-3 py-1 text-green-400 max-w-40 truncate">
                  {user.nickname || user.email}
                </span>
                <Button variant="outline" size="sm" className="border-zinc-700" onClick={openHistory}>
                  <History className="mr-1 h-3.5 w-3.5" /> 我的计划
                </Button>
                <Button variant="ghost" size="sm" className="text-zinc-500" onClick={doLogout}>
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="border-zinc-700" onClick={() => setAuthOpen(true)}>
                <LogIn className="mr-1 h-3.5 w-3.5" /> 邮箱登录
              </Button>
            )}
          </div>
          <div className="mb-2 flex items-center justify-center gap-2">
            <Dumbbell className="h-7 w-7 text-blue-400" />
            <h1 className="text-2xl font-bold">AI 私教计划生成器</h1>
          </div>
          <p className="text-sm text-zinc-500">填 30 秒问卷，大模型为你定制训练计划，自动配上 302 个标准动作动图</p>
          {!user && <p className="mt-1 text-xs text-zinc-600">游客可免费体验 1 次 · 登录后无限生成并保存计划</p>}
        </header>

        {step === 'form' && (
          <Card className="border-zinc-800 bg-[#16181c]">
            <CardHeader><CardTitle className="text-base">你的身体档案</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><Label>昵称</Label><Input className="mt-1 bg-zinc-900 border-zinc-700" value={profile.nickname} onChange={(e) => setProfile({ ...profile, nickname: e.target.value })} placeholder="可选" /></div>
                <div><Label>性别</Label>
                  <Select value={profile.gender} onValueChange={(v) => setProfile({ ...profile, gender: v })}>
                    <SelectTrigger className="mt-1 bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="男">男</SelectItem><SelectItem value="女">女</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>年龄</Label><Input className="mt-1 bg-zinc-900 border-zinc-700" type="number" value={profile.age} onChange={(e) => setProfile({ ...profile, age: e.target.value })} placeholder="24" /></div>
                <div><Label>体重 kg</Label><Input className="mt-1 bg-zinc-900 border-zinc-700" type="number" value={profile.weight} onChange={(e) => setProfile({ ...profile, weight: e.target.value })} placeholder="57.5" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><Label>身高 cm</Label><Input className="mt-1 bg-zinc-900 border-zinc-700" type="number" value={profile.height} onChange={(e) => setProfile({ ...profile, height: e.target.value })} placeholder="165" /></div>
                <div><Label>训练目标</Label>
                  <Select value={profile.goal} onValueChange={(v) => setProfile({ ...profile, goal: v })}>
                    <SelectTrigger className="mt-1 bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
                    <SelectContent>{GOALS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>每周练几次</Label>
                  <Select value={profile.daysPerWeek} onValueChange={(v) => setProfile({ ...profile, daysPerWeek: v })}>
                    <SelectTrigger className="mt-1 bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
                    <SelectContent>{['2', '3', '4', '5', '6'].map((d) => <SelectItem key={d} value={d}>{d} 次</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>每次时长</Label>
                  <Select value={profile.minutesPerSession} onValueChange={(v) => setProfile({ ...profile, minutesPerSession: v })}>
                    <SelectTrigger className="mt-1 bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
                    <SelectContent>{['20', '30', '45', '60', '90'].map((d) => <SelectItem key={d} value={d}>{d} 分钟</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>可用器械（多选）</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {EQUIPMENT_OPTIONS.map((e) => (
                    <button key={e} type="button" onClick={() => toggleEquipment(e)}
                      className={`rounded-full border px-4 py-1.5 text-sm transition ${profile.equipment.includes(e) ? 'border-blue-500 bg-blue-500/20 text-blue-300' : 'border-zinc-700 bg-zinc-900 text-zinc-400'}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>计划周期</Label>
                  <Select value={profile.durationWeeks} onValueChange={(v) => setProfile({ ...profile, durationWeeks: v })}>
                    <SelectTrigger className="mt-1 bg-zinc-900 border-zinc-700"><SelectValue /></SelectTrigger>
                    <SelectContent>{['4', '8', '12'].map((d) => <SelectItem key={d} value={d}>{d} 周</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>伤病/不适部位</Label><Input className="mt-1 bg-zinc-900 border-zinc-700" value={profile.injuries} onChange={(e) => setProfile({ ...profile, injuries: e.target.value })} placeholder="如：膝盖、肩膀（没有留空）" /></div>
              </div>
              <div><Label>补充说明</Label><Textarea className="mt-1 bg-zinc-900 border-zinc-700" value={profile.note} onChange={(e) => setProfile({ ...profile, note: e.target.value })} placeholder="如：备考期时间少、想重点练肩、家里有瑜伽垫…" /></div>
              <Button className="w-full bg-blue-600 hover:bg-blue-500" size="lg" onClick={generate}>
                <Sparkles className="mr-2 h-4 w-4" /> 生成我的专属计划
              </Button>
            </CardContent>
          </Card>
        )}

        {step === 'loading' && (
          <div className="flex flex-col items-center gap-6 py-24 text-zinc-400">
            <Loader2 className="h-10 w-10 animate-spin text-blue-400" />
            <p>教练正在为你定制计划，全程约 1 分钟</p>
            <div className="w-full max-w-sm space-y-2">
              {progress.map((p, i) => (
                <div key={i} className={`flex items-center gap-2 text-sm ${i === progress.length - 1 ? 'text-zinc-200' : 'text-zinc-500'}`}>
                  {i === progress.length - 1
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400 shrink-0" />
                    : <span className="text-green-500 shrink-0">✓</span>}
                  <span>{p}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-600">进度实时推送中，请不要关闭页面</p>
          </div>
        )}

        {step === 'plan' && plan && (
          <div className="space-y-6">
            <Card className="border-zinc-800 bg-[#16181c]">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold">{plan.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-400">{plan.summary}</p>
                  </div>
                  <Badge variant="outline" className={source === 'llm' ? 'border-green-500/40 text-green-400' : 'border-yellow-500/40 text-yellow-400'}>
                    {source === 'llm' ? 'AI 生成' : '规则引擎'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* 游客提示：本次不保存 */}
            {!user && !saved && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
                <span>游客模式：本次计划不会被保存，刷新后消失</span>
                <Button size="sm" variant="outline" className="border-yellow-500/40 text-yellow-300 shrink-0" onClick={() => setAuthOpen(true)}>
                  登录保存
                </Button>
              </div>
            )}

            {/* 四模块导航 */}
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-zinc-900 p-1">
              {MODULES.map((m) => (
                <button key={m.key} onClick={() => setModule(m.key)}
                  className={`rounded-lg py-2.5 text-center transition ${module === m.key ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  <div className="text-sm font-bold">{m.label}</div>
                  <div className={`text-[10px] ${module === m.key ? 'text-blue-200' : 'text-zinc-600'}`}>{m.sub}</div>
                </button>
              ))}
            </div>

            {module === 'boji' && (
            <Tabs defaultValue="0">
              <TabsList className="bg-zinc-900">
                {plan.weeks.map((w, i) => <TabsTrigger key={i} value={String(i)}>第 {w.week} 周</TabsTrigger>)}
              </TabsList>
              {plan.weeks.map((w, i) => (
                <TabsContent key={i} value={String(i)} className="mt-4 space-y-4">
                  {w.focus && <p className="text-sm text-zinc-500">本周重点：{w.focus}</p>}
                  {w.days.map((d, di) => (
                    <Card key={di} className="border-zinc-800 bg-[#16181c]">
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <CardTitle className="text-base">{d.day} · {d.name}</CardTitle>
                          <Badge variant="outline" className={TYPE_STYLE[d.type].cls}>{TYPE_STYLE[d.type].label}</Badge>
                        </div>
                        {d.note && <p className="text-xs text-zinc-500">{d.note}</p>}
                      </CardHeader>
                      {d.exercises.length > 0 && (
                        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {d.exercises.map((ex, ei) => (
                            <div key={ei} className="overflow-hidden rounded-xl bg-zinc-900">
                              {ex.custom || !ex.slug ? (
                                <div className="flex h-32 items-center justify-center bg-[#1a1d21] text-3xl font-bold text-zinc-700">{ex.name.slice(0, 1)}</div>
                              ) : (
                                <MotionScrub slug={ex.slug} name={ex.name} />
                              )}
                              <div className="p-3">
                                <div className="text-sm font-medium">{ex.name}</div>
                                <div className="mt-1 text-xs text-zinc-400">{ex.sets} · 休息 {ex.rest}</div>
                                {ex.cue && <div className="mt-1 text-xs leading-relaxed text-zinc-500">{ex.cue}</div>}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </TabsContent>
              ))}
            </Tabs>
            )}

            {module === 'boji' && plan.tips.length > 0 && (
              <Card className="border-zinc-800 bg-[#16181c]">
                <CardHeader><CardTitle className="text-base">执行要点</CardTitle></CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-400">
                    {plan.tips.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </CardContent>
              </Card>
            )}

            {module === 'dashui' && (
              <Card className="border-sky-500/20 bg-gradient-to-br from-sky-950/40 to-[#16181c]">
                <CardHeader><CardTitle className="text-base">💧 大水 · 每日饮水目标</CardTitle></CardHeader>
                <CardContent>
                  {plan.hydration ? (
                    <>
                      <div className="mb-3 text-3xl font-bold text-sky-400">
                        {plan.hydration.dailyMl} <span className="text-base font-normal text-zinc-400">ml / 天</span>
                      </div>
                      <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-400">
                        {plan.hydration.lines.map((l, i) => <li key={i}>{l}</li>)}
                      </ul>
                    </>
                  ) : (
                    <p className="text-sm text-zinc-500">本次生成未包含饮水建议。参考标准：男 1700 ml / 女 1500 ml 起，少量多次。</p>
                  )}
                </CardContent>
              </Card>
            )}

            {module === 'dashui2' && (
              <Card className="border-indigo-500/20 bg-gradient-to-br from-indigo-950/40 to-[#16181c]">
                <CardHeader><CardTitle className="text-base">😴 大睡 · 睡眠方案</CardTitle></CardHeader>
                <CardContent>
                  {plan.sleep ? (
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-400">
                      {plan.sleep.lines.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  ) : (
                    <p className="text-sm text-zinc-500">本次生成未包含睡眠建议。参考标准：7~9 小时，固定起床时间。</p>
                  )}
                </CardContent>
              </Card>
            )}

            {module === 'huangmao' && (
              <Card className="border-amber-500/20 bg-gradient-to-br from-amber-950/30 to-[#16181c]">
                <CardHeader><CardTitle className="text-base">😎 黄毛 · 心态建设</CardTitle></CardHeader>
                <CardContent>
                  <p className="mb-3 text-xs text-zinc-500">不是教你学坏——是建立自己的生活、边界、节奏和选择权。训练如此，生活也如此。</p>
                  {plan.mindset && plan.mindset.length > 0 ? (
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-400">
                      {plan.mindset.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  ) : (
                    <p className="text-sm text-zinc-500">本次生成未包含心态建议。</p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="border-zinc-800 bg-[#16181c]">
              <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row">
                <Input className="flex-1 bg-zinc-900 border-zinc-700" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="输入邮箱，把计划发给你" />
                <Button className="bg-blue-600 hover:bg-blue-500" disabled={sending || !email} onClick={sendEmail}>
                  {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />} 发送到邮箱
                </Button>
                <Button variant="outline" className="border-zinc-700" onClick={() => { setStep('form'); setPlan(null) }}>
                  <RotateCcw className="mr-2 h-4 w-4" /> 重新定制
                </Button>
              </CardContent>
            </Card>

            <p className="pb-6 text-center text-xs text-zinc-600">
              动作图 © Bryl Lim / Everkinetic · CC BY-SA 4.0 · 本计划仅供参考，不构成医疗建议
            </p>
          </div>
        )}
      </div>

      {/* 登录弹窗：邮箱 + 验证码，免密码 */}
      {authOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => setAuthOpen(false)}>
          <Card className="w-full max-w-sm border-zinc-700 bg-[#16181c]" onClick={(e) => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">邮箱登录</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>邮箱</Label>
                <Input className="mt-1 bg-zinc-900 border-zinc-700" type="email" value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@example.com" disabled={codeSent} />
              </div>
              {codeSent && (
                <div>
                  <Label>验证码</Label>
                  <Input className="mt-1 bg-zinc-900 border-zinc-700 tracking-widest" value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)} placeholder="6 位数字" maxLength={6} />
                </div>
              )}
              <div className="flex gap-2">
                {!codeSent ? (
                  <Button className="flex-1 bg-blue-600 hover:bg-blue-500" disabled={authBusy} onClick={sendCode}>
                    {authBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />} 发送验证码
                  </Button>
                ) : (
                  <>
                    <Button className="flex-1 bg-blue-600 hover:bg-blue-500" disabled={authBusy || authCode.length !== 6} onClick={login}>
                      {authBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />} 登录
                    </Button>
                    <Button variant="outline" className="border-zinc-700" disabled={countdown > 0} onClick={sendCode}>
                      {countdown > 0 ? `${countdown}s` : '重发'}
                    </Button>
                  </>
                )}
              </div>
              <p className="text-xs text-zinc-600">免密码登录：验证码 10 分钟内有效，未注册的邮箱会自动创建账号</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 历史计划弹窗 */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => setHistoryOpen(false)}>
          <Card className="w-full max-w-md border-zinc-700 bg-[#16181c]" onClick={(e) => e.stopPropagation()}>
            <CardHeader><CardTitle className="text-base">我的计划</CardTitle></CardHeader>
            <CardContent>
              {myPlans.length === 0 ? (
                <p className="text-sm text-zinc-500">还没有保存的计划，去生成一个吧</p>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {myPlans.map((p) => (
                    <button key={p.id} onClick={() => loadPlan(p.id)}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:border-zinc-600">
                      <div>
                        <div className="text-sm font-medium">{p.title}</div>
                        <div className="text-xs text-zinc-500">{new Date(p.created_at).toLocaleString('zh-CN')}</div>
                      </div>
                      <Badge variant="outline" className={p.source === 'llm' ? 'border-green-500/40 text-green-400' : 'border-yellow-500/40 text-yellow-400'}>
                        {p.source === 'llm' ? 'AI' : '规则'}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
