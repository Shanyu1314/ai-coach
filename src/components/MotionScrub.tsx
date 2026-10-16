// 动作图集拖动检视组件 —— oil-motion frame-scrub 路线
// 规范依据：motion/build/timeline.json + references/runtime.md
// - 输入事件只更新目标值，渲染集中在 requestAnimationFrame（createFrameAnimator）
// - 环形输入走最短环形距离，边界 loop
// - 离屏/切后台暂停；加载前只显示静态层；失败回退静态 GIF
// - prefers-reduced-motion：静态 K0，不自动播放、不连续 scrub
import { useEffect, useRef, useState } from 'react'
import { createFrameAnimator, createCssSpriteRenderer } from '@/lib/interactive-motion'

const SEQ = [0, 1, 2, 1] // 闭环序列（timeline.json circularSequence）
const LOOP_LEN = SEQ.length
const AUTOPLAY_MS = 550
const PX_PER_STEP = 80 // 每 80px 拖动推进一个帧位

type Props = { slug: string; name: string }

export function MotionScrub({ slug, name }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const url = `/assets/atlas/${slug}.webp`

    let destroyed = false
    let animator: ReturnType<typeof createFrameAnimator> | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let visible = true
    let loadStarted = false // 懒加载：进入视口附近才请求图片
    let position = 0 // 闭环浮点位置 [0, LOOP_LEN)
    let dragging = false
    let lastX = 0

    const img = new Image()

    const startLoad = () => {
      if (loadStarted || destroyed) return
      loadStarted = true
      img.src = url
      img.decode().then(() => {
        if (destroyed) return
        host.style.backgroundImage = `url(${url})`
        const renderFrame = createCssSpriteRenderer(host, 3, 1)
        animator = createFrameAnimator({
          frameCount: LOOP_LEN,
          circular: true,
          smoothTime: 0.12,
          reducedMotion: reduced,
          render: (f) => renderFrame(SEQ[Math.round(f) % LOOP_LEN]),
        })
        setStatus('ready')

        // 静态降级：reduced motion 只显示 K0，不自动播放
        if (reduced) return

        // 无交互自动播放；用户拖动后暂停 2.5s 再恢复
        const tick = () => {
          if (destroyed) return
          if (visible && !dragging && !document.hidden) {
            position = (position + 1) % LOOP_LEN
            animator?.setTarget(position)
          }
          idleTimer = setTimeout(tick, AUTOPLAY_MS)
        }
        idleTimer = setTimeout(tick, AUTOPLAY_MS)
      }).catch(() => { if (!destroyed) setStatus('error') })
    }

    // 离屏暂停 + 懒加载触发（提前 300px 开始加载，滚动到时不突兀）
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (entry.isIntersecting) startLoad()
    }, { rootMargin: '300px' })
    io.observe(host)

    // 拖动 scrub：事件只更新目标，渲染交给 animator 的 rAF
    const onDown = (e: PointerEvent) => {
      if (!animator) return
      dragging = true
      lastX = e.clientX
      host.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging || !animator) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      position = (((position + dx / PX_PER_STEP) % LOOP_LEN) + LOOP_LEN) % LOOP_LEN
      animator.setTarget(position)
    }
    const onUp = () => { dragging = false }
    host.addEventListener('pointerdown', onDown)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerup', onUp)
    host.addEventListener('pointercancel', onUp)

    return () => {
      destroyed = true
      animator?.destroy()
      if (idleTimer) clearTimeout(idleTimer)
      io.disconnect()
      host.removeEventListener('pointerdown', onDown)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerup', onUp)
      host.removeEventListener('pointercancel', onUp)
    }
  }, [slug])

  if (status === 'error') {
    // 资源失败：回退静态画面，不阻塞页面
    return <img src={`/assets/gifs/${slug}.gif`} alt={name} loading="lazy" className="w-full bg-[#1a1d21]" />
  }

  return (
    <div className="group relative">
      <div
        ref={hostRef}
        role="img"
        aria-label={name}
        className="aspect-square w-full cursor-grab touch-pan-y select-none bg-[#1a1d21] bg-no-repeat active:cursor-grabbing"
      />
      {status === 'loading' && (
        <div className="absolute inset-0 animate-pulse bg-zinc-800/40" />
      )}
      <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100">
        ⇆ 拖动逐帧看
      </div>
    </div>
  )
}
