import { CSSProperties, HTMLAttributes, useEffect, useRef } from 'react'
import './LetterGlitch.css'

type ClickEffect = 'tear' | 'burst' | 'none'
type Props = HTMLAttributes<HTMLDivElement> & {
  glitchColors?: string[]; baseColor?: string; characters?: string; fontFamily?: string
  fontSize?: number; spacing?: number; density?: number; baseOpacity?: number
  glitchAmount?: number; speed?: number; flow?: number; smooth?: boolean
  interactive?: boolean; cursorRadius?: number; clickEffect?: ClickEffect
  edgeFade?: number; centerFade?: number; intro?: boolean; lightMode?: boolean
  backgroundColor?: string; dpr?: number; className?: string; style?: CSSProperties
}

const CHARACTERS='ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789'

export default function LetterGlitch({
  glitchColors=['#ffffff','#61dca3'], baseColor='#ffffff', characters=CHARACTERS,
  fontFamily="ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize=14,
  spacing=.6, density=.9, baseOpacity=.16, glitchAmount=.5, speed=1, flow=.5,
  interactive=true, cursorRadius=140, clickEffect='tear', edgeFade=0, centerFade=0,
  intro=true, lightMode=false, backgroundColor, dpr, className='', style, ...rest
}:Props){
  const containerRef=useRef<HTMLDivElement>(null)
  const canvasRef=useRef<HTMLCanvasElement>(null)
  const pointer=useRef({x:-1000,y:-1000,inside:false,click:0})

  useEffect(()=>{
    const container=containerRef.current
    const canvas=canvasRef.current
    const context=canvas?.getContext('2d')
    if(!container||!canvas||!context)return
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false
    let frame=0;let width=1;let height=1;let ratio=1;let start=performance.now()
    const colors=glitchColors.slice(0,8)
    const resize=()=>{const rect=container.getBoundingClientRect();ratio=Math.min(dpr||window.devicePixelRatio||1,2);width=rect.width;height=rect.height;canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;context.setTransform(ratio,0,0,ratio,0,0)}
    const locate=(event:PointerEvent)=>{const rect=container.getBoundingClientRect();pointer.current.x=event.clientX-rect.left;pointer.current.y=event.clientY-rect.top;pointer.current.inside=pointer.current.x>=0&&pointer.current.y>=0&&pointer.current.x<=rect.width&&pointer.current.y<=rect.height}
    const move=(event:PointerEvent)=>locate(event)
    const leave=()=>{pointer.current.inside=false}
    const down=(event:PointerEvent)=>{locate(event);if(clickEffect!=='none')pointer.current.click=1}
    const draw=(now:number)=>{
      const elapsed=(now-start)/1000
      context.clearRect(0,0,width,height)
      if(backgroundColor){context.fillStyle=backgroundColor;context.fillRect(0,0,width,height)}
      const cellX=Math.max(8,fontSize*(1+spacing));const cellY=Math.max(10,fontSize*(1.15+spacing));
      const cols=Math.ceil(width/cellX)+1;const rows=Math.ceil(height/cellY)+1
      context.font=`${fontSize}px ${fontFamily}`;context.textAlign='center';context.textBaseline='middle'
      const activeSpeed=reduced?0:speed;const introAmount=intro?Math.min(1,elapsed/1.2):1
      for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
        const x=col*cellX;const y=row*cellY
        const seed=Math.abs(Math.sin(col*12.9898+row*78.233))*43758.5453
        if((seed%1)>density)continue
        const phase=elapsed*activeSpeed+seed
        const wave=(Math.sin(col*.16+elapsed*.7)+Math.cos(row*.19-elapsed*.45)+2)/4
        const flicker=(Math.sin(phase*2.1)>1-glitchAmount*.08)||(Math.sin(phase*11.7)>.985)
        let opacity=baseOpacity*(1-flow+flow*(.28+wave*1.25))*introAmount
        let color=lightMode?'#18181b':baseColor
        if(flicker&&!reduced){opacity=.42+wave*.5;color=colors[Math.floor(seed)%Math.max(1,colors.length)]||color}
        if(interactive&&pointer.current.inside){const distance=Math.hypot(x-pointer.current.x,y-pointer.current.y);const influence=Math.max(0,1-distance/cursorRadius);if(influence>0){opacity=Math.max(opacity,influence*.85);color=colors[(col+row)%Math.max(1,colors.length)]||color}}
        if(pointer.current.click>0&&clickEffect==='tear'){const band=Math.abs(y-pointer.current.y);if(band<24+pointer.current.click*55){opacity=Math.max(opacity,pointer.current.click);color=colors[(col+row)%Math.max(1,colors.length)]||color}}
        if(pointer.current.click>0&&clickEffect==='burst'){const ring=Math.abs(Math.hypot(x-pointer.current.x,y-pointer.current.y)-(1-pointer.current.click)*360);if(ring<35){opacity=Math.max(opacity,pointer.current.click);color=colors[(col+row)%Math.max(1,colors.length)]||color}}
        if(edgeFade>0){const edge=Math.min(x,y,width-x,height-y)/(Math.min(width,height)*edgeFade);opacity*=Math.max(0,Math.min(1,edge))}
        if(centerFade>0){const centerDistance=Math.hypot((x-width/2)/(width*.34),(y-height/2)/(height*.3));opacity*=1-centerFade*Math.max(0,1-centerDistance)}
        context.globalAlpha=Math.max(0,Math.min(1,opacity));context.fillStyle=color
        const index=Math.floor((seed+Math.floor(phase*(flicker?12:.25)))*characters.length)%characters.length
        context.fillText(characters[index]||'A',x,y)
      }
      context.globalAlpha=1;pointer.current.click=Math.max(0,pointer.current.click-.035)
      frame=requestAnimationFrame(draw)
    }
    const observer=new ResizeObserver(resize);observer.observe(container)
    window.addEventListener('pointermove',move,{passive:true});window.addEventListener('pointerdown',down,{passive:true});container.addEventListener('pointerleave',leave)
    resize();frame=requestAnimationFrame(draw)
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',down);container.removeEventListener('pointerleave',leave)}
  },[glitchColors,baseColor,characters,fontFamily,fontSize,spacing,density,baseOpacity,glitchAmount,speed,flow,interactive,cursorRadius,clickEffect,edgeFade,centerFade,intro,lightMode,backgroundColor,dpr])

  return <div ref={containerRef} className={`letter-glitch${className?` ${className}`:''}`} style={style} {...rest}><canvas ref={canvasRef} className="letter-glitch-canvas" aria-hidden="true"/></div>
}
