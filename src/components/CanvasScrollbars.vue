<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

// 与 Vue Flow 视口联动的画布滚动条：横向/纵向各一条。
// 滚动条表示「所有节点包围盒 + 边距」这一内容区域，拖动滑块即平移画布视图，
// 鼠标拖拽/缩放画布时滑块位置也会同步更新。
const { viewport, dimensions, nodes, setViewport } = useVueFlow()

const PAD = 160 // 内容区域在节点包围盒外的额外边距（flow 坐标）
const MIN_THUMB = 28 // 滑块最小像素长度

const content = computed(() => {
  const list = nodes.value || []
  if (!list.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of list) {
    const p = n.computedPosition || n.position
    if (!p) continue
    const w = (n.dimensions && n.dimensions.width) || 180
    const h = (n.dimensions && n.dimensions.height) || 80
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x + w > maxX) maxX = p.x + w
    if (p.y + h > maxY) maxY = p.y + h
  }
  if (!Number.isFinite(minX)) return null
  return {
    x: minX - PAD,
    y: minY - PAD,
    width: maxX - minX + PAD * 2,
    height: maxY - minY + PAD * 2,
  }
})

function axisGeo(axis) {
  const c = content.value
  const d = dimensions.value || {}
  const trackPx = axis === 'x' ? d.width : d.height
  if (!c || !trackPx) return null
  const z = viewport.value.zoom || 1
  const contentSize = axis === 'x' ? c.width : c.height
  const contentStart = axis === 'x' ? c.x : c.y
  const visible = trackPx / z
  const offset = (axis === 'x' ? -viewport.value.x : -viewport.value.y) / z
  const scrollable = Math.max(0, contentSize - visible)
  const ratio = contentSize > 0 ? Math.min(1, visible / contentSize) : 1
  const thumbPx = Math.max(MIN_THUMB, Math.min(trackPx, trackPx * ratio))
  const scroll = Math.min(scrollable, Math.max(0, offset - contentStart))
  const thumbPos = scrollable > 0 ? (trackPx - thumbPx) * (scroll / scrollable) : 0
  return { trackPx, visible, contentStart, scrollable, thumbPx, thumbPos, dragRange: trackPx - thumbPx }
}

const hGeo = computed(() => axisGeo('x'))
const vGeo = computed(() => axisGeo('y'))

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// 拖动滑块：像素位移换算为视口平移量
const dragState = ref(null)
function onThumbDown(axis, e) {
  e.preventDefault()
  e.stopPropagation()
  const geo = axis === 'x' ? hGeo.value : vGeo.value
  if (!geo) return
  const z = viewport.value.zoom || 1
  const start = (axis === 'x' ? -viewport.value.x : -viewport.value.y) / z
  dragState.value = { axis, client: axis === 'x' ? e.clientX : e.clientY, start }
  window.addEventListener('pointermove', onThumbMove)
  window.addEventListener('pointerup', onThumbUp)
}
function onThumbMove(e) {
  const d = dragState.value
  if (!d) return
  const geo = d.axis === 'x' ? hGeo.value : vGeo.value
  if (!geo || geo.scrollable <= 0 || geo.dragRange <= 0) return
  const cur = d.axis === 'x' ? e.clientX : e.clientY
  const flowDelta = ((cur - d.client) / geo.dragRange) * geo.scrollable
  const target = clamp(d.start + flowDelta, geo.contentStart, geo.contentStart + geo.scrollable)
  applyOffset(d.axis, target)
}
function onThumbUp() {
  dragState.value = null
  window.removeEventListener('pointermove', onThumbMove)
  window.removeEventListener('pointerup', onThumbUp)
}
onBeforeUnmount(onThumbUp)

function applyOffset(axis, flowOffset) {
  const z = viewport.value.zoom || 1
  const next =
    axis === 'x'
      ? { x: -flowOffset * z, y: viewport.value.y, zoom: z }
      : { x: viewport.value.x, y: -flowOffset * z, zoom: z }
  setViewport(next)
}

// 点击轨道：将点击位置居中映射到视口
function onTrackDown(axis, e) {
  const geo = axis === 'x' ? hGeo.value : vGeo.value
  if (!geo || geo.scrollable <= 0) return
  e.stopPropagation()
  const rect = e.currentTarget.getBoundingClientRect()
  const pos = axis === 'x' ? e.clientX - rect.left : e.clientY - rect.top
  const ratio = clamp(pos / geo.trackPx, 0, 1)
  const target = clamp(
    geo.contentStart + ratio * geo.scrollable - geo.visible / 2,
    geo.contentStart,
    geo.contentStart + geo.scrollable
  )
  applyOffset(axis, target)
}
</script>

<template>
  <template v-if="content">
    <div class="canvas-scroll canvas-scroll-x" @pointerdown="onTrackDown('x', $event)">
      <div
        v-if="hGeo"
        class="thumb"
        :style="{ left: hGeo.thumbPos + 'px', width: Math.max(hGeo.thumbPx, 1) + 'px' }"
        @pointerdown="onThumbDown('x', $event)"
      />
    </div>
    <div class="canvas-scroll canvas-scroll-y" @pointerdown="onTrackDown('y', $event)">
      <div
        v-if="vGeo"
        class="thumb"
        :style="{ top: vGeo.thumbPos + 'px', height: Math.max(vGeo.thumbPx, 1) + 'px' }"
        @pointerdown="onThumbDown('y', $event)"
      />
    </div>
  </template>
</template>

<style scoped>
.canvas-scroll {
  position: absolute;
  background: rgba(15, 17, 23, 0.55);
  z-index: 6;
}
.canvas-scroll-x {
  left: 0;
  right: 0;
  bottom: 0;
  height: 12px;
  border-top: 1px solid var(--border);
}
.canvas-scroll-y {
  top: 0;
  bottom: 0;
  right: 0;
  width: 12px;
  border-left: 1px solid var(--border);
}
.thumb {
  position: absolute;
  border-radius: 6px;
  background: var(--border);
  cursor: grab;
}
.thumb:hover {
  background: var(--accent);
}
.canvas-scroll-x .thumb {
  top: 2px;
  height: 8px;
}
.canvas-scroll-y .thumb {
  left: 2px;
  width: 8px;
}
</style>
