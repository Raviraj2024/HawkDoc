import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, MousePointer2, Plus, ZoomIn, ZoomOut } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { FormField, FormTemplate } from './types'

type Interaction = {
  kind: 'draw' | 'move' | 'resize'
  fieldId?: string
  handle?: 'nw' | 'ne' | 'sw' | 'se'
  startX: number
  startY: number
  original: number[]
}

type Props = {
  template: FormTemplate
  page: number
  setPage: (page: number) => void
  selectedId: string | null
  select: (id: string | null) => void
  addMode: boolean
  setAddMode: (value: boolean) => void
  updateBox: (field: FormField, box: number[]) => Promise<void>
  createBox: (box: number[], page: number) => Promise<void>
  analyzing?: boolean
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))
const normalized = (box: number[]) => [Math.min(box[0], box[2]), Math.min(box[1], box[3]), Math.max(box[0], box[2]), Math.max(box[1], box[3])]
const MIN_BOX_WIDTH = 0.002
const MIN_BOX_HEIGHT = 0.002
const validBox = (box: number[]) => box.length === 4 && box.every(Number.isFinite)
  && box.every(value => value >= 0 && value <= 1) && box[0] < box[2] && box[1] < box[3]
const sameBox = (a: number[], b: number[]) => a.every((value, index) => Math.abs(value - b[index]) < 1e-9)

export default function MappingCanvas({ template, page, setPage, selectedId, select, addMode, setAddMode, updateBox, createBox, analyzing = false }: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(100)
  const interactionRef = useRef<Interaction | null>(null)
  const finishRef = useRef<() => void>(() => undefined)
  const [liveBoxes, setLiveBoxes] = useState<Record<string, number[]>>({})
  const liveBoxesRef = useRef<Record<string, number[]>>({})
  const [draftBox, setDraftBox] = useState<number[] | null>(null)
  const draftBoxRef = useRef<number[] | null>(null)
  const fields = (template.fields ?? []).filter(field => field.page_index === page)

  const point = (clientX: number, clientY: number) => {
    const rect = surfaceRef.current!.getBoundingClientRect()
    return [clamp((clientX - rect.left) / rect.width), clamp((clientY - rect.top) / rect.height)]
  }

  const beginDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!addMode || event.button !== 0 || event.target !== event.currentTarget) return
    event.preventDefault()
    const [x, y] = point(event.clientX, event.clientY)
    const nextInteraction: Interaction = { kind: 'draw', startX: x, startY: y, original: [x, y, x, y] }
    interactionRef.current = nextInteraction
    draftBoxRef.current = [x, y, x, y]; setDraftBox(draftBoxRef.current)
    select(null)
  }

  const beginField = (event: ReactPointerEvent, field: FormField, kind: 'move' | 'resize', handle?: Interaction['handle']) => {
    if (addMode || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const [x, y] = point(event.clientX, event.clientY)
    select(field.id)
    const nextInteraction: Interaction = { kind, fieldId: field.id, handle, startX: x, startY: y, original: [...field.bbox_norm] }
    interactionRef.current = nextInteraction
  }

  const move = (clientX: number, clientY: number) => {
    const currentInteraction = interactionRef.current
    if (!currentInteraction || !surfaceRef.current) return
    const [x, y] = point(clientX, clientY)
    if (currentInteraction.kind === 'draw') {
      const box = normalized([currentInteraction.startX, currentInteraction.startY, x, y])
      draftBoxRef.current = box; setDraftBox(box)
      return
    }
    const dx = x - currentInteraction.startX, dy = y - currentInteraction.startY
    let box = [...currentInteraction.original]
    if (currentInteraction.kind === 'move') {
      const width = box[2] - box[0], height = box[3] - box[1]
      box[0] = clamp(Math.min(box[0] + dx, 1 - width)); box[1] = clamp(Math.min(box[1] + dy, 1 - height))
      box[2] = box[0] + width; box[3] = box[1] + height
    } else {
      if (currentInteraction.handle?.includes('w')) {
        const minimum = Math.min(MIN_BOX_WIDTH, box[2])
        box[0] = Math.max(0, Math.min(clamp(x), box[2] - minimum))
      }
      if (currentInteraction.handle?.includes('e')) {
        const minimum = Math.min(MIN_BOX_WIDTH, 1 - box[0])
        box[2] = Math.min(1, Math.max(clamp(x), box[0] + minimum))
      }
      if (currentInteraction.handle?.includes('n')) {
        const minimum = Math.min(MIN_BOX_HEIGHT, box[3])
        box[1] = Math.max(0, Math.min(clamp(y), box[3] - minimum))
      }
      if (currentInteraction.handle?.includes('s')) {
        const minimum = Math.min(MIN_BOX_HEIGHT, 1 - box[1])
        box[3] = Math.min(1, Math.max(clamp(y), box[1] + minimum))
      }
    }
    liveBoxesRef.current = { ...liveBoxesRef.current, [currentInteraction.fieldId!]: box }
    setLiveBoxes(liveBoxesRef.current)
  }

  const finish = () => {
    const completed = interactionRef.current
    if (!completed) return
    interactionRef.current = null
    if (completed.kind === 'draw') {
      const box = draftBoxRef.current
      draftBoxRef.current = null; setDraftBox(null); setAddMode(false)
      if (box && box[2] - box[0] >= .015 && box[3] - box[1] >= .008) void createBox(box, page)
    } else if (completed.fieldId) {
      const field = fields.find(item => item.id === completed.fieldId)
      const box = liveBoxesRef.current[completed.fieldId]
      if (field && box && validBox(box) && !sameBox(field.bbox_norm, box)) void updateBox(field, box).finally(() => {
        const next = { ...liveBoxesRef.current }; delete next[completed.fieldId!]
        liveBoxesRef.current = next; setLiveBoxes(next)
      })
      else if (box) {
        const next = { ...liveBoxesRef.current }; delete next[completed.fieldId!]
        liveBoxesRef.current = next; setLiveBoxes(next)
      }
    }
  }
  finishRef.current = finish

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      if (!interactionRef.current) return
      event.preventDefault()
      move(event.clientX, event.clientY)
    }
    const handleFinish = () => finishRef.current()
    window.addEventListener('pointermove', handleMove, { passive: false })
    window.addEventListener('pointerup', handleFinish)
    window.addEventListener('pointercancel', handleFinish)
    window.addEventListener('blur', handleFinish)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleFinish)
      window.removeEventListener('pointercancel', handleFinish)
      window.removeEventListener('blur', handleFinish)
    }
  }, [])

  return <section className="document-stage mapping-stage">
    <div className="mapping-toolbar">
      <div className="page-controls"><button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} aria-label="Previous page"><ChevronLeft size={16}/></button><span>Page {page + 1} of {template.page_count}</span><button onClick={() => setPage(Math.min(template.page_count - 1, page + 1))} disabled={page === template.page_count - 1} aria-label="Next page"><ChevronRight size={16}/></button></div>
      <div className="mapping-tools"><button className={!addMode ? 'active' : ''} onClick={() => setAddMode(false)}><MousePointer2 size={15}/>Select</button><button className={addMode ? 'active' : ''} onClick={() => setAddMode(!addMode)}><Plus size={15}/>Draw field</button></div>
      <div className="zoom-controls"><button onClick={() => setZoom(Math.max(60, zoom - 10))} aria-label="Zoom out"><ZoomOut size={15}/></button><span>{zoom}%</span><button onClick={() => setZoom(Math.min(180, zoom + 10))} aria-label="Zoom in"><ZoomIn size={15}/></button></div>
    </div>
    <div className={addMode ? 'mapping-scroll is-drawing' : 'mapping-scroll'}>
      <div className="mapping-page" style={{ width: `${zoom}%` }}>
        <img src={`/api/templates/${template.id}/pages/${page}/preview`} draggable={false} alt={`Blank form page ${page + 1}`} />
        <div ref={surfaceRef} className="mapping-surface" onPointerDown={beginDraw}>
          {fields.map((field) => {
            const box = liveBoxes[field.id] ?? field.bbox_norm
            const active = selectedId === field.id
            return <div key={field.id} className={`map-box ${active ? 'active' : ''} ${field.mapping_status === 'confirmed' ? 'confirmed' : ''}`} style={{ left:`${box[0]*100}%`, top:`${box[1]*100}%`, width:`${(box[2]-box[0])*100}%`, height:`${(box[3]-box[1])*100}%` }} onPointerDown={event => beginField(event, field, 'move')}>
              {active && <>{(['nw','ne','sw','se'] as const).map(handle => <button key={handle} className={`resize-handle resize-${handle}`} onPointerDown={event => beginField(event, field, 'resize', handle)} aria-label={`Resize ${handle}`} />)}</>}
            </div>
          })}
          {draftBox && <div className="map-box draft" style={{ left:`${draftBox[0]*100}%`, top:`${draftBox[1]*100}%`, width:`${(draftBox[2]-draftBox[0])*100}%`, height:`${(draftBox[3]-draftBox[1])*100}%` }} />}
        </div>
      </div>
    </div>
    {analyzing && <div className="mapping-analysis" role="status"><span className="analysis-spinner"/><strong>Muse is mapping this form</strong><p>Detecting writable areas, field types, entity roles, and normalized coordinates. This can take a moment.</p></div>}
    <div className="mapping-hint">{addMode ? 'Drag over the exact writable area. Release to create the field.' : 'Select a field to move it. Drag corner handles to resize.'}</div>
  </section>
}
