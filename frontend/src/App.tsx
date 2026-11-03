import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Download, FileCheck2, FilePlus2, Files, LayoutDashboard, LoaderCircle, Menu, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import { api } from './api'
import hawkDocLogo from './assets/hawkdoc-logo.png'
import LetterGlitch from './LetterGlitch'
import MappingCanvas from './MappingCanvas'
import type { AuditEvent, Claim, Decision, Entity, FillSession, FillSummary, FormField, FormTemplate, IntakeQuestion, Requirement, ReviewIssue, UploadedDocument } from './types'

type Module = 'dashboard' | 'forms' | 'fill' | 'filled'
type FillStage = 'upload' | 'review' | 'form' | 'audit'
type Toast = { kind: 'error' | 'success'; text: string } | null

const readLocation = () => {
  const query = new URLSearchParams(window.location.search)
  const view = query.get('view')
  const module: Module = view === 'forms' || view === 'fill' || view === 'filled' ? view : 'dashboard'
  const stageValue = query.get('stage')
  const stage: FillStage = stageValue === 'review' || stageValue === 'form' || stageValue === 'audit' ? stageValue : 'upload'
  return { module, templateId: query.get('template'), fillId: query.get('fill'), stage }
}

const writeLocation = (values: { module: Module; templateId?: string | null; fillId?: string | null; stage?: FillStage }, replace=false) => {
  const query = new URLSearchParams()
  query.set('view', values.module)
  if(values.templateId)query.set('template',values.templateId)
  if(values.fillId)query.set('fill',values.fillId)
  if(values.stage&&values.fillId)query.set('stage',values.stage)
  const url = `${window.location.pathname}?${query.toString()}`
  window.history[replace?'replaceState':'pushState'](null,'',url)
}

const statusLabel = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase())
const dateLabel = (value: string) => new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))

function Status({ value }: { value: string }) {
  const tone = value === 'ready' || value === 'auto_supported' || value === 'supported' || value === 'exported' ? 'positive'
    : value === 'unresolved' || value === 'error' || value === 'wrong_type' || value === 'needs_review' ? 'negative'
    : value === 'human_reviewed' ? 'reviewed' : 'neutral'
  return <span className={`status status--${tone}`}><i />{statusLabel(value)}</span>
}

function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Files; title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><Icon size={26} strokeWidth={1.4} /><h3>{title}</h3><p>{text}</p>{action}</div>
}

function App() {
  const initialLocation = useMemo(readLocation, [])
  const [entered,setEntered]=useState(()=>new URLSearchParams(window.location.search).has('view'))
  const [module, setModule] = useState<Module>(initialLocation.module)
  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [templatesLoading,setTemplatesLoading]=useState(true)
  const [selected, setSelected] = useState<FormTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast>(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarOpen,setSidebarOpen]=useState(true)
  const [routeFillId,setRouteFillId]=useState<string|null>(initialLocation.fillId)
  const [routeStage,setRouteStage]=useState<FillStage>(initialLocation.stage)

  const loadTemplates = async () => {
    setTemplatesLoading(true)
    try { setTemplates(await api.templates()) } catch (error) { notifyError(error) } finally { setTemplatesLoading(false) }
  }
  useEffect(() => { if(entered)void loadTemplates() }, [entered])
  useEffect(()=>{if(initialLocation.module==='forms'&&initialLocation.templateId)void openTemplate(initialLocation.templateId)},[])
  useEffect(() => { if (toast) { const id = setTimeout(() => setToast(null), 4500); return () => clearTimeout(id) } }, [toast])

  const notifyError = (error: unknown) => setToast({ kind: 'error', text: error instanceof Error ? error.message : 'Something went wrong.' })
  const openTemplate = async (id: string) => {
    setBusy(true)
    try { setSelected(await api.template(id));writeLocation({module:'forms',templateId:id}) } catch (error) { notifyError(error) } finally { setBusy(false) }
  }
  const navigate = (next: Module) => { setModule(next);setSelected(null);setMobileNav(false);if(next==='fill'){setRouteFillId(null);setRouteStage('upload')}writeLocation({module:next}) }
  const openFill=(id:string,stage:FillStage)=>{setRouteFillId(id);setRouteStage(stage);setModule('fill');writeLocation({module:'fill',fillId:id,stage})}

  if(!entered)return <LandingScreen onEnter={()=>{setEntered(true);setModule('dashboard');writeLocation({module:'dashboard'})}}/>

  return <div className={`app-shell ${sidebarOpen?'sidebar-expanded':'sidebar-collapsed'}`}>
    <aside className={`app-sidebar ${mobileNav?'mobile-open':''}`}>
      <button className="brand" onClick={() => {setEntered(false);setMobileNav(false);window.history.pushState(null,'',window.location.pathname)}} aria-label="Return to HawkDoc landing screen">
        <img className="brand-logo" src={hawkDocLogo} alt="" />
        <span className="brand-name">HawkDoc</span>
      </button>
      <nav className="side-nav" aria-label="Primary navigation">
        <button className={module === 'dashboard' ? 'active' : ''} onClick={() => navigate('dashboard')}><LayoutDashboard size={18}/><span>Dashboard</span></button>
        <button className={module === 'forms' ? 'active' : ''} onClick={() => navigate('forms')}><Files size={18}/><span>Forms</span></button>
        <button className={module === 'fill' ? 'active' : ''} onClick={() => navigate('fill')}><FilePlus2 size={18}/><span>Fill a form</span></button>
        <button className={module === 'filled' ? 'active' : ''} onClick={() => navigate('filled')}><FileCheck2 size={18}/><span>Filled forms</span></button>
      </nav>
      <div className="sidebar-foot"><span className="system-dot"/><span>Evidence workspace</span></div>
      <button className="sidebar-toggle" onClick={()=>setSidebarOpen(open=>!open)} aria-label={sidebarOpen?'Collapse sidebar':'Expand sidebar'}>{sidebarOpen?<ChevronLeft size={17}/>:<ChevronRight size={17}/>}</button>
    </aside>
    <button className="mobile-menu mobile-sidebar-toggle" onClick={() => setMobileNav(v => !v)} aria-label="Toggle navigation"><Menu size={20} /></button>
    {mobileNav&&<button className="sidebar-mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}

    <main className="workspace-main">
      {module === 'dashboard'
        ? <Dashboard templates={templates} templatesLoading={templatesLoading} onNavigate={navigate} onOpen={openFill} notify={setToast}/>
        : module === 'forms'
        ? selected ? <TemplateEditor template={selected} setTemplate={setSelected} onBack={() => { setSelected(null);writeLocation({module:'forms'});loadTemplates() }} notify={setToast} />
          : <FormsHome templates={templates} busy={busy||templatesLoading} refresh={loadTemplates} openTemplate={openTemplate} notify={setToast} />
        : module==='filled' ? <FilledFormsHome onOpen={openFill} notify={setToast}/>
        : templatesLoading?<PageLoader label="Loading form workspace"/>:<FillWorkspace templates={templates.filter(t => t.status === 'ready')} notify={setToast} initialFillId={routeFillId} initialStage={routeStage} onLocationChange={(fillId,stage)=>{setRouteFillId(fillId);setRouteStage(stage);writeLocation({module:'fill',fillId,stage},true)}} />}
    </main>
    {toast && <div className={`toast toast--${toast.kind}`} role="status">{toast.kind === 'error' ? <AlertCircle size={18} /> : <Check size={18} />}{toast.text}<button onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>
}

function LandingScreen({onEnter}:{onEnter:()=>void}){
  return <main className="landing-screen landing-screen--editorial">
    <header className="landing-nav"><div className="landing-wordmark"><img className="landing-logo" src={hawkDocLogo} alt=""/><strong>HawkDoc</strong></div><span>Evidence intelligence · 2026</span></header>
    <section className="landing-hero">
      <p className="landing-kicker"><span/>From evidence to exact output</p>
      <h1><span>Forms that</span><strong>understand.</strong></h1>
      <div className="landing-hero-bottom"><p>Turn scattered documents into verified, reviewable forms—without losing the source behind any answer.</p><button className="landing-enter" onClick={onEnter}><span>Enter<br/>workspace</span><ArrowRight size={24}/></button></div>
    </section>
    <LandingProcessVisual/>
    <div className="landing-marquee" aria-hidden="true"><div><span>MAP ONCE · EXTRACT · VERIFY · FILL · AUDIT · MAP ONCE · EXTRACT · VERIFY · FILL · AUDIT · MAP ONCE · EXTRACT · VERIFY · FILL · AUDIT · MAP ONCE · EXTRACT · VERIFY · FILL · AUDIT · </span><span>MAP ONCE · EXTRACT · VERIFY · FILL · AUDIT · MAP ONCE · EXTRACT · VERIFY · FILL · AUDIT · MAP ONCE · EXTRACT · VERIFY · FILL · AUDIT · MAP ONCE · EXTRACT · VERIFY · FILL · AUDIT · </span></div></div>
    <footer className="landing-foot" style={{display:'flex',justifyContent:'space-between'}}><span>01 — Map</span><span>02 — Reason</span><span>03 — Deliver</span></footer>
  </main>
}

function LandingProcessVisual(){
  return <div className="editorial-process" aria-label="Documents being converted into structured information">
    <div className="signal-window"><LetterGlitch glitchColors={['#0b4c88','#08743f','#071a2d']} baseColor="#071a2d" lightMode baseOpacity={.13} glitchAmount={.42} speed={.8} flow={.48} density={.76} fontSize={11} spacing={.9} cursorRadius={120} clickEffect="burst" centerFade={.16}/><span>LIVE<br/>EVIDENCE</span></div>
    <div className="paper paper--source"><div className="paper-label">SOURCE / 01</div><b/><b/><b/><b/><small>Applicant evidence</small></div>
    <div className="paper paper--source-two"><div className="paper-label">SOURCE / 02</div><b/><b/><b/><small>Supporting record</small></div>
    <div className="scan-axis"><i/><span>READING</span></div>
    <div className="extracted-tags"><span>NAME <b>✓</b></span><span>ADDRESS <b>✓</b></span><span>IDENTITY <b>✓</b></span></div>
    <div className="paper paper--output"><div className="paper-label">VERIFIED / OUTPUT</div><b/><b/><b/><b/><div className="approval-mark">✓</div><small>Ready for review</small></div>
  </div>
}

function PageLoader({label}:{label:string}){return <div className="page-loader" role="status"><span className="loader-orbit"><i/><i/><i/></span><strong>{label}</strong><small>Retrieving the latest workspace data</small></div>}

function Dashboard({templates,templatesLoading,onNavigate,onOpen,notify}:{templates:FormTemplate[];templatesLoading:boolean;onNavigate:(module:Module)=>void;onOpen:(id:string,stage:FillStage)=>void;notify:(v:Toast)=>void}){
  const [fills,setFills]=useState<FillSummary[]>([])
  const [loading,setLoading]=useState(true)
  useEffect(()=>{api.fills().then(setFills).catch(error=>notify({kind:'error',text:error instanceof Error?error.message:'Could not load dashboard activity.'})).finally(()=>setLoading(false))},[])
  if(loading||templatesLoading)return <PageLoader label="Loading dashboard"/>
  const exported=fills.filter(fill=>fill.status==='exported'||Boolean(fill.exported_at)).length
  const processed=fills.filter(fill=>!['awaiting_answers','awaiting_documents','extracting','mapping_values','error'].includes(fill.status)).length
  const active=fills.filter(fill=>['extracting','mapping_values'].includes(fill.status)).length
  const inReview=fills.filter(fill=>fill.open_issue_count>0||fill.status==='needs_review').length
  const readyTemplates=templates.filter(template=>template.status==='ready').length
  const documents=fills.reduce((total,fill)=>total+fill.document_count,0)
  const claims=fills.reduce((total,fill)=>total+fill.claim_count,0)
  const recent=[...fills].sort((a,b)=>new Date(b.last_activity_at).getTime()-new Date(a.last_activity_at).getTime()).slice(0,5)
  const resumeStage=(fill:FillSummary):FillStage=>['awaiting_answers','awaiting_documents','error'].includes(fill.status)?'upload':fill.open_issue_count?'review':'form'
  return <div className="page-wrap dashboard-page">
    <PageIntro eyebrow="Workspace overview" title="Dashboard." detail="A concise view of template readiness, evidence processing, review workload, and completed exports." action={<button className="button button--primary" onClick={()=>onNavigate('fill')}><FilePlus2 size={17}/>Fill a form</button>}/>
    <section className="metric-band" aria-label="Workspace totals">
      <div><span>Form templates</span><strong>{templates.length}</strong><small>{readyTemplates} ready to use</small></div>
      <div><span>Fill sessions</span><strong>{fills.length}</strong><small>{active} currently processing</small></div>
      <div><span>Processed</span><strong>{processed}</strong><small>{inReview} requiring review</small></div>
      <div><span>Exported</span><strong>{exported}</strong><small>Completed output files</small></div>
    </section>
    <div className="dashboard-grid">
      <section className="dashboard-section pipeline-section">
        <div className="section-heading"><div><p className="eyebrow">Operational status</p><h2>Processing pipeline</h2></div><button className="text-button" onClick={()=>onNavigate('filled')}>View all <ChevronRight size={15}/></button></div>
        <div className="pipeline-list">
          <div><span>Awaiting evidence</span><strong>{fills.filter(fill=>['awaiting_answers','awaiting_documents'].includes(fill.status)).length}</strong></div>
          <div><span>Processing</span><strong>{active}</strong></div>
          <div><span>Review required</span><strong>{inReview}</strong></div>
          <div><span>Ready or exported</span><strong>{fills.filter(fill=>fill.status==='ready_to_export'||fill.status==='exported'||Boolean(fill.exported_at)).length}</strong></div>
        </div>
        <div className="evidence-totals"><span><b>{documents}</b> documents retained</span><span><b>{claims}</b> extracted claims</span></div>
      </section>
      <section className="dashboard-section recent-section">
        <div className="section-heading"><div><p className="eyebrow">Recent activity</p><h2>Latest form sessions</h2></div></div>
        {recent.length===0?<EmptyState icon={FileCheck2} title="No activity yet" text="Start a form fill to see processing and export activity here." action={<button className="text-button" onClick={()=>onNavigate('fill')}>Start a form <ChevronRight size={15}/></button>}/>:<div className="recent-list">{recent.map(fill=><button key={fill.id} onClick={()=>onOpen(fill.id,resumeStage(fill))}><span><strong>{fill.template_name}</strong><small>{dateLabel(fill.last_activity_at)} · {fill.document_count} documents</small></span><Status value={fill.status}/><ChevronRight size={16}/></button>)}</div>}
      </section>
    </div>
  </div>
}

function FilledFormsHome({onOpen,notify}:{onOpen:(id:string,stage:FillStage)=>void;notify:(v:Toast)=>void}){
  const [fills,setFills]=useState<FillSummary[]>([])
  const [loading,setLoading]=useState(true)
  useEffect(()=>{api.fills().then(setFills).catch(error=>notify({kind:'error',text:error instanceof Error?error.message:'Could not load filled forms.'})).finally(()=>setLoading(false))},[])
  if(loading)return <PageLoader label="Loading filled forms"/>
  return <div className="page-wrap"><PageIntro eyebrow="Application workspace" title="Filled forms." detail="Resume evidence collection, continue review, or reopen completed form sessions without processing the same documents again."/><section className="filled-forms-list"><div className="table-head fill-history-grid"><span>Form</span><span>Evidence</span><span>Review</span><span>Last activity</span><span/></div>{fills.length===0?<EmptyState icon={FileCheck2} title="No fill sessions yet" text="Start from Fill a form. Sessions will appear here as soon as they are created."/>:fills.map(item=><button className="table-row fill-history-grid" key={item.id} onClick={()=>onOpen(item.id,['awaiting_answers','awaiting_documents','error'].includes(item.status)?'upload':item.open_issue_count?'review':'form')}><span className="template-name"><FileCheck2 size={18}/><span><strong>{item.template_name}</strong><small>{item.id.slice(0,8).toUpperCase()}</small></span></span><span>{item.document_count} documents<small>{item.claim_count} extracted claims</small></span><span><Status value={item.status}/><small>{item.open_issue_count} open issues</small></span><span>{dateLabel(item.last_activity_at)}</span><span className="resume-link">Open <ChevronRight size={16}/></span></button>)}</section></div>
}

function PageIntro({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="page-intro"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-detail">{detail}</p></div>{action}</div>
}

function FormsHome({ templates, busy, refresh, openTemplate, notify }: { templates: FormTemplate[]; busy: boolean; refresh: () => void; openTemplate: (id:string)=>void; notify:(v:Toast)=>void }) {
  const [uploading, setUploading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [query, setQuery] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const filtered = templates.filter(t => t.name.toLowerCase().includes(query.toLowerCase()))

  const upload = async (event: React.FormEvent) => {
    event.preventDefault(); const name = nameRef.current?.value.trim(); const file = fileRef.current?.files?.[0]
    if (!name || !file) return
    setUploading(true)
    try {
      const created = await api.createTemplate(name, file)
      notify({ kind: 'success', text: 'Form uploaded. Muse is detecting fields and semantic roles.' })
      try { await api.parseTemplate(created.id) }
      catch (error) { notify({ kind: 'error', text: `The form was saved, but automatic mapping failed: ${error instanceof Error ? error.message : 'Model request failed.'}` }) }
      setShowUpload(false); refresh(); await openTemplate(created.id)
    }
    catch (error) { notify({ kind: 'error', text: error instanceof Error ? error.message : 'Upload failed.' }) }
    finally { setUploading(false) }
  }

  const remove = async (template: FormTemplate) => {
    if (!confirm(`Permanently delete “${template.name}”? This will also delete every fill session, uploaded document, extracted value, export, and audit log associated with this template.`)) return
    try {
      await api.deleteTemplate(template.id)
      notify({ kind: 'success', text: 'Template and all associated history were deleted.' })
      refresh()
    } catch (error) {
      notify({ kind: 'error', text: error instanceof Error ? error.message : 'Could not delete template.' })
    }
  }

  return <div className="page-wrap">
    <PageIntro eyebrow="Template library" title="Teach the system a form once." detail="Create reusable field maps with explicit entity roles, source rules, and review requirements." action={<button className="button button--primary" onClick={() => setShowUpload(true)}><Plus size={17} />New form template</button>} />
    <div className="toolbar">
      <label className="search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates" /></label>
      <button className="icon-button" onClick={refresh} aria-label="Refresh templates"><RefreshCw size={17} /></button>
    </div>
    <section className="data-section" aria-label="Form templates">
      <div className="table-head template-grid"><span>Template</span><span>Mapping</span><span>Pages</span><span>Updated</span><span /></div>
      {busy ? <div className="loading-row"><LoaderCircle className="spin" size={20} />Loading templates</div>
        : filtered.length === 0 ? <EmptyState icon={Files} title={templates.length ? 'No matching templates' : 'No templates yet'} text={templates.length ? 'Try a different search term.' : 'Upload a blank PDF to create the first reusable form definition.'} action={!templates.length ? <button className="text-button" onClick={() => setShowUpload(true)}>Upload blank form <ChevronRight size={15} /></button> : undefined} />
        : filtered.map(template => <div className="table-row template-grid template-row" key={template.id}>
          <button className="template-row-open" onClick={() => openTemplate(template.id)}>
            <span className="template-name"><FileCheck2 size={18} /><span><strong>{template.name}</strong><small>{template.original_filename}</small></span></span>
            <span><Status value={template.status} /></span><span>{template.page_count}</span><span>{dateLabel(template.created_at)}</span>
          </button>
          <button className="icon-button danger template-delete" onClick={() => void remove(template)} aria-label={`Delete ${template.name}`} title="Delete template"><Trash2 size={16} /></button>
        </div>)}
    </section>
    {showUpload && createPortal(<div className="modal-backdrop" onMouseDown={() => setShowUpload(false)}><section className="modal" onMouseDown={e => e.stopPropagation()} aria-modal="true" role="dialog">
      <div className="modal-heading"><div><p className="eyebrow">New template</p><h2>Upload a blank form</h2></div><button className="icon-button" onClick={() => setShowUpload(false)}><X size={18} /></button></div>
      <p className="muted">The original PDF is preserved unchanged. Muse will propose fields and geometry for your review.</p>
      <form onSubmit={upload} className="stack-form"><label>Template name<input ref={nameRef} required placeholder="e.g. Claims application" /></label><label>Blank PDF<input ref={fileRef} required type="file" accept="application/pdf" /></label><div className="modal-actions"><button type="button" className="button" disabled={uploading} onClick={() => setShowUpload(false)}>Cancel</button><button className="button button--primary" disabled={uploading}>{uploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}{uploading ? 'Mapping form…' : 'Upload and map form'}</button></div></form>
    </section></div>, document.body)}
  </div>
}

function TemplateEditor({ template, setTemplate, onBack, notify }: { template: FormTemplate; setTemplate:(t:FormTemplate)=>void; onBack:()=>void; notify:(v:Toast)=>void }) {
  const [selectedFieldId, setSelectedFieldId] = useState(template.fields?.[0]?.id ?? null)
  const [working, setWorking] = useState(false)
  const [tab, setTab] = useState<'fields'|'requirements'|'questions'>('fields')
  const [page, setPage] = useState(template.fields?.[0]?.page_index ?? 0)
  const [addMode, setAddMode] = useState(false)
  const [sourcePolicyDrafts,setSourcePolicyDrafts]=useState<Record<string,Record<string,unknown>>>({})
  const autoDiscoveryStarted = useRef(false)
  const selectedField = template.fields?.find(f => f.id === selectedFieldId) ?? null
  const reload = async () => setTemplate(await api.template(template.id))
  const parse = async (replaceExisting = false) => { setWorking(true); try { await api.parseTemplate(template.id, replaceExisting); await reload(); notify({kind:'success', text:'High-detail field proposals are ready for review.'}) } catch (e) { notify({kind:'error', text:e instanceof Error?e.message:'Field discovery failed.'}) } finally { setWorking(false) } }
  useEffect(() => {
    if (!autoDiscoveryStarted.current && template.status === 'uploaded' && !template.fields?.length) {
      autoDiscoveryStarted.current = true
      void parse(false)
    }
  }, [template.id, template.status])
  const updateField = async (field: FormField, patch: Partial<FormField>) => {
    try { await api.patchField(template.id, field.id, patch); await reload() } catch (e) { notify({kind:'error', text:e instanceof Error?e.message:'Could not update field.'}) }
  }
  const saveSourcePolicies=async()=>{const entries=Object.entries(sourcePolicyDrafts).map(([field_id,source_policy])=>({field_id,source_policy}));if(!entries.length)return;await api.sourcePolicies(template.id,entries);setSourcePolicyDrafts({});await reload();notify({kind:'success',text:`Saved evidence-source rules for ${entries.length} ${entries.length===1?'field':'fields'}.`})}
  const createBox = async (bbox: number[], pageIndex: number) => {
    try {
      const count = (template.fields?.length ?? 0) + 1
      const field = await api.addField(template.id, {
        display_label: `New field ${count}`, canonical_key: `field_${count}`, semantic_target: `applicant.field_${count}`,
        entity_role: 'applicant', field_type: 'text', page_index: pageIndex, bbox_norm: bbox, format: null,
        required: false, mapping_status: 'needs_review', source_policy: {}, instruction: null, group_key: null,
        cell_config: null, auto_fillable: true,
      })
      await reload(); setSelectedFieldId(field.id)
      notify({ kind: 'success', text: 'Field created. Complete its semantic properties before confirming.' })
    } catch (e) { notify({kind:'error', text:e instanceof Error ? e.message : 'Could not create field.'}) }
  }
  const confirmAll = async () => {
    setWorking(true)
    try { await saveSourcePolicies(); for (const field of template.fields ?? []) if (field.mapping_status !== 'confirmed') await api.patchField(template.id, field.id, { mapping_status: 'confirmed' }); await api.confirmTemplate(template.id); await reload(); notify({kind:'success', text:'Template confirmed and ready to use.'}) }
    catch (e) { notify({kind:'error', text:e instanceof Error?e.message:'Could not confirm template.'}) } finally { setWorking(false) }
  }

  return <div className="editor-shell">
    <div className="editor-topline"><button className="back-button" onClick={onBack}><ArrowLeft size={17} />Template library</button><div className="editor-title"><strong>{template.name}</strong><Status value={template.status} /></div><div className="editor-actions">{Object.keys(sourcePolicyDrafts).length>0&&<button className="button" disabled={working} onClick={()=>{setWorking(true);saveSourcePolicies().catch(e=>notify({kind:'error',text:e instanceof Error?e.message:'Could not save source rules.'})).finally(()=>setWorking(false))}}>{working?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>}Save source rules ({Object.keys(sourcePolicyDrafts).length})</button>}<button className="button button--primary" disabled={working || !template.fields?.length} onClick={confirmAll}>{working ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{template.status === 'ready' ? 'Reconfirm mapping' : 'Confirm mapping'}</button></div></div>
    <div className="editor-layout">
      <aside className="field-rail">
        <div className="tab-switch tab-switch--three"><button className={tab==='fields'?'active':''} onClick={()=>setTab('fields')}>Fields <span>{template.fields?.length ?? 0}</span></button><button className={tab==='requirements'?'active':''} onClick={()=>setTab('requirements')}>Documents <span>{template.requirements?.length ?? 0}</span></button><button className={tab==='questions'?'active':''} onClick={()=>setTab('questions')}>Questions <span>{template.intake_questions?.length ?? 0}</span></button></div>
        {tab === 'fields' ? <>
          {!template.fields?.length ? <EmptyState icon={FilePlus2} title="No field map" text="Run field discovery to identify writable areas and their semantic meaning." action={<button className="text-button" disabled={working} onClick={()=>parse(false)}>{working?<LoaderCircle className="spin" size={16}/>:null}Discover fields</button>} />
            : <div className="field-list"><div className="rail-map-actions"><button className="rail-add-field" onClick={()=>setAddMode(true)}><Plus size={15}/>Draw a new field</button>{template.status!=='ready'&&<button className="rail-refine-field" disabled={working} onClick={()=>{if(confirm('Replace all current proposals with one new high-detail Muse analysis per page? Manual field edits in this unconfirmed template will be removed.')) void parse(true)}}><RefreshCw className={working?'spin':''} size={14}/>Re-run page mapping</button>}</div>{template.fields.map((field, index) => <button key={field.id} className={selectedFieldId===field.id?'field-item active':'field-item'} onClick={()=>{setSelectedFieldId(field.id);setPage(field.page_index);setAddMode(false)}}><span className="field-index">{String(index+1).padStart(2,'0')}</span><span><strong>{field.display_label}</strong><small>Page {field.page_index+1} · {field.semantic_target}</small></span><i className={sourcePolicyDrafts[field.id]?'pending':field.mapping_status==='confirmed'?'confirmed':''}/></button>)}</div>}
        </> : tab==='requirements' ? <RequirementsEditor template={template} reload={reload} notify={notify} /> : <QuestionsEditor template={template} reload={reload} notify={notify}/>} 
      </aside>
      <MappingCanvas template={template} page={page} setPage={setPage} selectedId={selectedFieldId} select={setSelectedFieldId} addMode={addMode} setAddMode={setAddMode} updateBox={async(field,box)=>updateField(field,{bbox_norm:box,mapping_status:'needs_review'})} createBox={createBox} analyzing={working && !template.fields?.length}/>
      <aside className="properties-panel">{selectedField ? <FieldProperties field={selectedField} requirements={template.requirements??[]} pendingSourcePolicy={sourcePolicyDrafts[selectedField.id]} onSourcePolicyChange={policy=>setSourcePolicyDrafts(current=>({...current,[selectedField.id]:policy}))} update={updateField} remove={async()=>{ if(!confirm('Remove this field from the template?'))return; await api.deleteField(template.id,selectedField.id);setSelectedFieldId(null);await reload() }} /> : <div className="properties-empty"><p className="eyebrow">Field properties</p><p>Select a detected field to inspect its meaning and source policy.</p></div>}</aside>
    </div>
  </div>
}

function FieldProperties({ field, requirements, pendingSourcePolicy, onSourcePolicyChange, update, remove }: { field:FormField; requirements:Requirement[]; pendingSourcePolicy?:Record<string,unknown>; onSourcePolicyChange:(policy:Record<string,unknown>)=>void; update:(f:FormField,p:Partial<FormField>)=>void; remove:()=>void }) {
  const [draft, setDraft] = useState(field)
  useEffect(()=>setDraft(field),[field])
  const effectiveSourcePolicy=pendingSourcePolicy??field.source_policy
  const allowedTypes=Array.isArray(effectiveSourcePolicy?.allowed_types)?effectiveSourcePolicy.allowed_types.filter((item):item is string=>typeof item==='string'):[]
  const setAllowedTypes=(types:string[])=>onSourcePolicyChange({...effectiveSourcePolicy,allowed_types:types,priority:types})
  const save = () => update(field, { display_label:draft.display_label, semantic_target:draft.semantic_target, canonical_key:draft.canonical_key, entity_role:draft.entity_role, field_type:draft.field_type, page_index:draft.page_index, bbox_norm:draft.bbox_norm, format:draft.format, required:draft.required, auto_fillable:draft.auto_fillable, instruction:draft.instruction, group_key:draft.group_key, cell_config:draft.cell_config, mapping_status:'needs_review' })
  return <div className="properties-content"><div className="properties-heading"><div><p className="eyebrow">Field properties</p><h2>{field.display_label}</h2></div><button className="icon-button danger" onClick={remove} aria-label="Delete field"><Trash2 size={16}/></button></div>
    <div className="coordinate-line"><span>Page {field.page_index+1}</span><span>{field.bbox_norm.map(n=>n.toFixed(3)).join(' · ')}</span></div>
    <div className="property-form"><label>Printed label<input value={draft.display_label} onChange={e=>setDraft({...draft,display_label:e.target.value})}/></label><label>Canonical key<input value={draft.canonical_key} onChange={e=>setDraft({...draft,canonical_key:e.target.value})}/></label><label>Semantic target<input value={draft.semantic_target} onChange={e=>setDraft({...draft,semantic_target:e.target.value})}/></label><div className="form-pair"><label>Entity role<input value={draft.entity_role} onChange={e=>setDraft({...draft,entity_role:e.target.value})}/></label><label>Field type<select value={draft.field_type} onChange={e=>setDraft({...draft,field_type:e.target.value})}><option>text</option><option>multiline</option><option>number</option><option>date</option><option>checkbox</option><option>radio</option><option>character_comb</option><option>signature</option></select></label></div><fieldset className="source-policy"><legend>Accepted evidence source <span>Optional</span></legend><label className="source-option"><input type="radio" name={`source-${field.id}`} checked={allowedTypes.length===0} onChange={()=>setAllowedTypes([])}/><span><strong>Automatic</strong><small>Accept any eligible verified document.</small></span></label>{requirements.map(requirement=><label className="source-option" key={requirement.type_key}><input type="checkbox" checked={allowedTypes.includes(requirement.type_key)} onChange={event=>setAllowedTypes(event.target.checked?[...allowedTypes,requirement.type_key]:allowedTypes.filter(type=>type!==requirement.type_key))}/><span><strong>{requirement.label}</strong><small>{requirement.type_key}</small></span></label>)}{requirements.length===0&&<p>Define document types in the Documents tab before restricting this field.</p>}</fieldset><label>Page number<input type="number" min="1" value={draft.page_index+1} onChange={e=>setDraft({...draft,page_index:Math.max(0,Number(e.target.value)-1)})}/></label><fieldset className="bbox-inputs"><legend>Normalized bounding box</legend>{['X min','Y min','X max','Y max'].map((label,index)=><label key={label}>{label}<input type="number" min="0" max="1" step="0.001" value={draft.bbox_norm[index]} onChange={e=>{const box=[...draft.bbox_norm];box[index]=Number(e.target.value);setDraft({...draft,bbox_norm:box})}}/></label>)}</fieldset><label>Output format<input value={draft.format??''} placeholder="Optional" onChange={e=>setDraft({...draft,format:e.target.value||null})}/></label>{['checkbox','radio'].includes(draft.field_type)&&<label>Selection group<input value={draft.group_key??''} placeholder="e.g. business_type" onChange={e=>setDraft({...draft,group_key:e.target.value||null})}/></label>}{draft.field_type==='character_comb'&&<label>Cell count<input type="number" min="1" value={Number(draft.cell_config?.cell_count??1)} onChange={e=>setDraft({...draft,cell_config:{...(draft.cell_config??{}),cell_count:Number(e.target.value)}})}/></label>}<label>Field instruction<textarea rows={3} value={draft.instruction??''} placeholder="Evidence or source constraints" onChange={e=>setDraft({...draft,instruction:e.target.value||null})}/></label><label className="check-line"><input type="checkbox" checked={draft.required} onChange={e=>setDraft({...draft,required:e.target.checked})}/><span>Required on form</span></label><label className="check-line"><input type="checkbox" checked={draft.auto_fillable} onChange={e=>setDraft({...draft,auto_fillable:e.target.checked})}/><span>May be auto-filled with supported evidence</span></label></div>
    <div className="panel-footer"><button className="button button--primary full" onClick={save}>Save field</button>{field.mapping_status!=='confirmed'&&<button className="text-button centered" onClick={()=>update(field,{mapping_status:'confirmed'})}><Check size={15}/>Mark field confirmed</button>}</div>
  </div>
}

function RequirementsEditor({template,reload,notify}:{template:FormTemplate;reload:()=>Promise<void>;notify:(v:Toast)=>void}) {
  const [items,setItems]=useState<Requirement[]>(template.requirements??[])
  useEffect(()=>setItems(template.requirements??[]),[template])
  const save=async()=>{const keys=items.map(item=>item.type_key);const duplicate=keys.find((key,index)=>key&&keys.indexOf(key)!==index);if(duplicate){notify({kind:'error',text:`Each document type must be unique. Remove or rename the duplicate “${duplicate.replaceAll('_',' ')}”.`});return}try{await api.requirements(template.id,items);await reload();notify({kind:'success',text:'Document requirements saved.'})}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Save failed.'})}}
  return <div className="requirements"><p className="rail-note">Define evidence expected for every new fill. Requirements are never inferred as legal obligations.</p>{items.map((r,i)=><div className="requirement-row" key={i}><input value={r.label} onChange={e=>setItems(items.map((x,j)=>j===i?{...x,label:e.target.value,type_key:e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')}:x))}/><label><input type="checkbox" checked={r.required} onChange={e=>setItems(items.map((x,j)=>j===i?{...x,required:e.target.checked}:x))}/>Required</label><button onClick={()=>setItems(items.filter((_,j)=>j!==i))}><X size={15}/></button></div>)}<button className="text-button" onClick={()=>setItems([...items,{type_key:'',label:'',required:true,description:null}])}><Plus size={15}/>Add document type</button><button className="button button--primary full" onClick={save}>Save requirements</button></div>
}

function QuestionsEditor({template,reload,notify}:{template:FormTemplate;reload:()=>Promise<void>;notify:(v:Toast)=>void}) {
  const [items,setItems]=useState<IntakeQuestion[]>(template.intake_questions??[])
  useEffect(()=>setItems(template.intake_questions??[]),[template])
  const keyFor=(prompt:string,index:number)=>prompt.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||`question_${index+1}`
  const save=async()=>{try{await api.questions(template.id,items.map((item,index)=>({...item,key:item.key||keyFor(item.prompt,index),options:item.answer_type==='select'?item.options.filter(Boolean):[]})));await reload();notify({kind:'success',text:'Pre-fill questions saved.'})}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Could not save questions.'})}}
  return <div className="questions-editor"><p className="rail-note">Ask for identity or intent before evidence upload. Answers guide entity recognition but do not replace documentary evidence.</p>{items.map((item,index)=><div className="question-editor-row" key={index}><input value={item.prompt} placeholder="e.g. What is the applicant's full name?" onChange={event=>setItems(items.map((question,i)=>i===index?{...question,prompt:event.target.value,key:keyFor(event.target.value,index)}:question))}/><div><select value={item.answer_type} onChange={event=>setItems(items.map((question,i)=>i===index?{...question,answer_type:event.target.value as IntakeQuestion['answer_type']}:question))}><option value="text">Text</option><option value="select">Select options</option><option value="yes_no">Yes / No</option></select><label><input type="checkbox" checked={item.required} onChange={event=>setItems(items.map((question,i)=>i===index?{...question,required:event.target.checked}:question))}/>Required</label><button onClick={()=>setItems(items.filter((_,i)=>i!==index))} aria-label="Remove question"><X size={14}/></button></div>{item.answer_type==='select'&&<input value={item.options.join(', ')} placeholder="Options separated by commas" onChange={event=>setItems(items.map((question,i)=>i===index?{...question,options:event.target.value.split(',').map(value=>value.trim())}:question))}/>}</div>)}<button className="text-button" onClick={()=>setItems([...items,{key:`question_${items.length+1}`,prompt:'',answer_type:'text',required:true,options:[]}])}><Plus size={15}/>Add question</button><button className="button button--primary full" onClick={save}>Save questions</button></div>
}

function FillWorkspace({templates,notify,initialFillId,initialStage,onLocationChange}:{templates:FormTemplate[];notify:(v:Toast)=>void;initialFillId:string|null;initialStage:FillStage;onLocationChange:(fillId:string|null,stage:FillStage)=>void}) {
  const [fill,setFill]=useState<FillSession|null>(null)
  const [fillHistory,setFillHistory]=useState<FillSummary[]>([])
  const [template,setTemplate]=useState<FormTemplate|null>(null)
  const [documents,setDocuments]=useState<UploadedDocument[]>([])
  const [issues,setIssues]=useState<ReviewIssue[]>([])
  const [decisions,setDecisions]=useState<Decision[]>([])
  const [entities,setEntities]=useState<Entity[]>([])
  const [claims,setClaims]=useState<Claim[]>([])
  const [audit,setAudit]=useState<AuditEvent[]>([])
  const [stage,setStage]=useState<FillStage>(initialStage)
  const [busy,setBusy]=useState(Boolean(initialFillId))
  const processing=fill?.status==='extracting'||fill?.status==='mapping_values'
  const processed=fill?.status==='needs_review'||fill?.status==='ready_to_export'||fill?.status==='exported'
  const chosenTemplate = template
  const hydrate=async(id:string)=>{const [f,d,i,ds,en,cl,au]=await Promise.all([api.fill(id),api.documents(id),api.issues(id),api.decisions(id),api.entities(id),api.claims(id),api.audit(id)]);setFill(f);setDocuments(d);setIssues(i);setDecisions(ds);setEntities(en.entities);setClaims(cl);setAudit(au)}
  const resume=async(id:string,requestedStage:FillStage='upload')=>{setBusy(true);try{const session=await api.fill(id);const full=await api.template(session.template_id);setTemplate(full);setStage(requestedStage);await hydrate(id);onLocationChange(id,requestedStage)}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Could not restore this fill.'})}finally{setBusy(false)}}
  useEffect(()=>{api.fills().then(setFillHistory).catch(e=>notify({kind:'error',text:e instanceof Error?e.message:'Could not load previous fills.'}))},[])
  useEffect(()=>{if(initialFillId&&!fill)void resume(initialFillId,initialStage)},[initialFillId])
  useEffect(()=>{if(fill?.id)onLocationChange(fill.id,stage)},[fill?.id,stage])
  useEffect(()=>{if(fill?.status==='extracting'||fill?.status==='mapping_values'){const id=setInterval(()=>hydrate(fill.id).catch(()=>{}),2500);return()=>clearInterval(id)}},[fill?.id,fill?.status])
  const begin=async(id:string)=>{setBusy(true);try{const full=await api.template(id);const session=await api.createFill(id);setTemplate(full);setFill(session);setStage('upload');onLocationChange(session.id,'upload');await hydrate(session.id)}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Could not create fill.'})}finally{setBusy(false)}}
  const process=async()=>{if(!fill||processing||processed)return;setBusy(true);try{await api.process(fill.id);await hydrate(fill.id);notify({kind:'success',text:'Evidence processing started. Review will unlock when it finishes.'})}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Processing failed.'})}finally{setBusy(false)}}
  useEffect(()=>{if(processed&&stage==='upload'){notify({kind:'success',text:'Evidence processing is complete. Review and form screens are now available.'})}},[processed])

  if(!fill||!chosenTemplate){
    if(busy)return <PageLoader label={initialFillId?'Restoring fill session':'Creating fill session'}/>
    return <div className="page-wrap"><PageIntro eyebrow="New application" title="Choose a form to fill." detail="Start a new evidence workflow from a reviewed template. Existing sessions are available separately under Filled forms."/><section className="template-picker"><div className="table-head picker-grid"><span>Ready template</span><span>Mapping</span><span>Next step</span><span/></div>{templates.length===0?<EmptyState icon={FileCheck2} title="No ready templates" text="Confirm at least one form mapping before starting a fill."/>:templates.map(item=><button className="table-row picker-grid" key={item.id} onClick={()=>begin(item.id)} disabled={busy}><span className="template-name"><FileCheck2 size={18}/><strong>{item.name}</strong></span><span><Status value={item.status}/></span><span>Start application</span><ChevronRight size={17}/></button>)}</section></div>
  }
  if(!fill||!chosenTemplate) return <div className="page-wrap"><PageIntro eyebrow="Evidence workflow" title="Fill a form with supported facts." detail="Resume a previous fill without uploading or processing its evidence again, or start a new fill from a reviewed template."/>{fillHistory.length>0&&<section className="fill-history"><div className="section-heading"><div><p className="eyebrow">Saved work</p><h2>Previous fills</h2></div><span>{fillHistory.length} sessions</span></div><div className="table-head fill-history-grid"><span>Form</span><span>Evidence</span><span>Review</span><span>Last activity</span><span/></div>{fillHistory.map(item=><button className="table-row fill-history-grid" key={item.id} onClick={()=>resume(item.id,['awaiting_answers','awaiting_documents','error'].includes(item.status)?'upload':item.open_issue_count?'review':'form')} disabled={busy}><span className="template-name"><FileCheck2 size={18}/><span><strong>{item.template_name}</strong><small>{item.id.slice(0,8).toUpperCase()}</small></span></span><span>{item.document_count} documents<br/><small>{item.claim_count} extracted claims</small></span><span><Status value={item.status}/><small>{item.open_issue_count} open issues</small></span><span>{dateLabel(item.last_activity_at)}</span><span className="resume-link">Resume <ChevronRight size={16}/></span></button>)}</section>}<section className="template-picker"><div className="section-heading"><div><p className="eyebrow">New workflow</p><h2>Start a new fill</h2></div></div><div className="table-head picker-grid"><span>Ready template</span><span>Fields</span><span>Required evidence</span><span/></div>{templates.length===0?<EmptyState icon={FileCheck2} title="No ready templates" text="Confirm at least one form mapping before starting a fill."/>:templates.map(t=><button className="table-row picker-grid" key={t.id} onClick={()=>begin(t.id)} disabled={busy}><span className="template-name"><FileCheck2 size={18}/><strong>{t.name}</strong></span><span>Open mapping</span><span>View after selection</span><ChevronRight size={17}/></button>)}</section></div>

  const openIssues=issues.filter(i=>i.status==='open'&&i.issue_type!=='wrong_document_type').length+documents.filter(document=>document.status==='needs_review'||document.status==='wrong_type').length
  return <div className="fill-shell"><div className="fill-header"><button className="back-button" onClick={()=>{setFill(null);setTemplate(null);setStage('upload');onLocationChange(null,'upload')}}><ArrowLeft size={17}/>Choose template</button><div><strong>{chosenTemplate.name}</strong><small>Fill {fill.id.slice(0,8).toUpperCase()}</small></div><Status value={fill.status}/></div>
    <nav className="progress-nav"><button className={stage==='upload'?'active':''} onClick={()=>setStage('upload')}><span>01</span>Evidence</button><button className={stage==='review'?'active':''} onClick={()=>setStage('review')} disabled={!processed}><span>02</span>Review {openIssues>0&&<b>{openIssues}</b>}</button><button className={stage==='form'?'active':''} onClick={()=>setStage('form')} disabled={!processed}><span>03</span>Filled form</button><button className={stage==='audit'?'active':''} onClick={()=>setStage('audit')} disabled={!processed}><span>04</span>Export & audit</button></nav>
    {stage==='upload'&&<EvidenceStage fill={fill} template={chosenTemplate} documents={documents} busy={busy} notify={notify} refresh={()=>hydrate(fill.id)} process={process}/>} 
    {stage==='review'&&<ReviewStageV2 fill={fill} template={chosenTemplate} issues={issues} claims={claims} entities={entities} documents={documents} refresh={()=>hydrate(fill.id)} notify={notify}/>} 
    {stage==='form'&&<FilledStage fill={fill} template={chosenTemplate} decisions={decisions} claims={claims} entities={entities} documents={documents} refresh={()=>hydrate(fill.id)} notify={notify}/>} 
    {stage==='audit'&&<AuditStage fill={fill} issues={issues} audit={audit} notify={notify}/>} 
  </div>
}

function EvidenceStage({fill,template,documents,busy,notify,refresh,process}:{fill:FillSession;template:FormTemplate;documents:UploadedDocument[];busy:boolean;notify:(v:Toast)=>void;refresh:()=>Promise<void>;process:()=>Promise<void>}) {
  const [typeKey,setTypeKey]=useState('');const [subject,setSubject]=useState('applicant');const fileRef=useRef<HTMLInputElement>(null);const [fileName,setFileName]=useState('');const [uploading,setUploading]=useState(false)
  const upload=async()=>{const files=Array.from(fileRef.current?.files??[]);if(!files.length)return;setUploading(true);try{if(files.length===1){await api.uploadDocument(fill.id,files[0],typeKey,subject);await refresh();notify({kind:'success',text:'Evidence document uploaded. Start processing when all documents are ready.'})}else{await api.uploadDocuments(fill.id,files,typeKey,subject);await refresh();notify({kind:'success',text:`${files.length} documents uploaded. Start processing when all documents are ready.`})}if(fileRef.current)fileRef.current.value='';setFileName('')}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Upload failed.'})}finally{setUploading(false)}}
  const processing=fill.status==='extracting'||fill.status==='mapping_values'
  const processed=fill.status==='needs_review'||fill.status==='ready_to_export'||fill.status==='exported'
  if(fill.status==='awaiting_answers')return <IntakeStage fill={fill} questions={template.intake_questions??[]} refresh={refresh} notify={notify}/>
  if(processing)return <div className="processing-lock" role="status" aria-live="polite"><LoaderCircle className="spin processing-lock__spinner" size={34}/><p className="eyebrow">Evidence processing</p><h2>{fill.status==='extracting'?'Reading and classifying documents':'Matching supported facts to form fields'}</h2><p>Muse is processing the uploaded evidence. This screen refreshes automatically; Review and later steps will unlock when processing finishes.</p><div className="processing-lock__steps"><span className="done">Documents uploaded</span><span className={fill.status==='mapping_values'?'done active':'active'}>Extracting evidence</span><span className={fill.status==='mapping_values'?'active':''}>Mapping values</span><span>Ready for review</span></div></div>
  if(fill.status==='error')return <div className="processing-lock processing-lock--error" role="alert"><AlertCircle size={34}/><p className="eyebrow">Processing stopped</p><h2>The model response could not be accepted</h2><p>{fill.error_detail||'An unexpected processing error occurred.'}</p><button className="button button--primary" onClick={process} disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<RefreshCw size={17}/>}Retry processing</button></div>
  if(processed)return <div className="processing-lock processing-lock--complete" role="status"><Check size={34}/><p className="eyebrow">Processing complete</p><h2>Evidence is ready for review</h2><p>{documents.length} document{documents.length===1?' was':'s were'} processed. Review, Filled form, and Export &amp; audit are now unlocked above.</p></div>
  return <div className="fill-content"><section className="evidence-main"><div className="section-heading"><div><p className="eyebrow">Supporting evidence</p><h2>Upload source documents</h2></div><span>{documents.length} received</span></div><div className="upload-line"><label className="file-control"><Upload size={19}/><span>{fileName||'Select PDF, JPG or PNG'}</span><input ref={fileRef} type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={e=>{const files=Array.from(e.currentTarget.files??[]);setFileName(files.length>1?`${files.length} documents selected`:files[0]?.name??'')}}/></label><select value={typeKey} onChange={e=>setTypeKey(e.target.value)}><option value="">Document type</option>{template.requirements?.map(r=><option key={r.type_key} value={r.type_key}>{r.label}</option>)}</select><select value={subject} onChange={e=>setSubject(e.target.value)}><option value="applicant">Applicant</option><option value="father">Father</option><option value="spouse">Spouse</option><option value="organization">Organization</option></select><button className="button button--primary" onClick={upload} disabled={uploading||!fileName}>{uploading?<LoaderCircle className="spin" size={17}/>:<Plus size={17}/>}Add</button></div><div className="document-list">{documents.length===0?<EmptyState icon={FilePlus2} title="No evidence uploaded" text="Add only the source files needed for this fill. No sample records are used."/>:documents.map((d,i)=><div className="document-row" key={d.id}><span className="doc-number">{String(i+1).padStart(2,'0')}</span><FileCheck2 size={19}/><span className="doc-title"><strong>{d.original_filename}</strong><small>{d.type_key?statusLabel(d.type_key):'Type pending'} · {d.subject_tag?statusLabel(d.subject_tag):'Owner pending'}</small></span><Status value={d.status}/></div>)}</div></section><aside className="evidence-aside"><p className="eyebrow">Evidence checklist</p>{template.requirements?.length?<div className="checklist">{template.requirements.map(r=>{const present=documents.some(d=>d.type_key===r.type_key);return <div key={r.type_key} className={present?'met':''}>{present?<Check size={16}/>:<Clock3 size={16}/>}<span><strong>{r.label}</strong><small>{r.required?'Required':'Optional'}</small></span></div>})}</div>:<p className="muted">No document requirements were configured.</p>}<div className="aside-action"><p>Processing sends document images to the configured Muse endpoint and preserves source regions.</p><button className="button button--primary full" onClick={process} disabled={busy||documents.length===0}>{busy?<LoaderCircle className="spin" size={17}/>:null}Process evidence</button></div></aside></div>
}

function IntakeStage({fill,questions,refresh,notify}:{fill:FillSession;questions:IntakeQuestion[];refresh:()=>Promise<void>;notify:(v:Toast)=>void}) {
  const [answers,setAnswers]=useState<Record<string,string>>(fill.intake_answers??{})
  const [saving,setSaving]=useState(false)
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setSaving(true);try{await api.saveAnswers(fill.id,answers);await refresh();notify({kind:'success',text:'Answers saved. You can now upload evidence.'})}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Could not save answers.'})}finally{setSaving(false)}}
  return <div className="intake-shell"><form className="intake-form" onSubmit={submit}><div className="section-heading"><div><p className="eyebrow">Before evidence upload</p><h2>Confirm the application context</h2></div><span>{questions.length} questions</span></div><p className="intake-intro">These answers help identify the correct applicant and interpret document options. Values are stored with this fill and never treated as documentary proof unless also visible in evidence.</p>{questions.map((question,index)=><label className="intake-question" key={question.key}><span><b>{String(index+1).padStart(2,'0')}</b>{question.prompt}{question.required&&<em>Required</em>}</span>{question.answer_type==='select'?<select required={question.required} value={answers[question.key]??''} onChange={event=>setAnswers({...answers,[question.key]:event.target.value})}><option value="">Select an answer</option>{question.options.map(option=><option key={option}>{option}</option>)}</select>:question.answer_type==='yes_no'?<select required={question.required} value={answers[question.key]??''} onChange={event=>setAnswers({...answers,[question.key]:event.target.value})}><option value="">Select an answer</option><option>Yes</option><option>No</option></select>:<input required={question.required} value={answers[question.key]??''} onChange={event=>setAnswers({...answers,[question.key]:event.target.value})}/>}</label>)}<div className="intake-actions"><p>Processing and document upload remain locked until required answers are saved.</p><button className="button button--primary" disabled={saving}>{saving?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}Save and continue</button></div></form></div>
}
function ReviewStage({fill,issues,claims,entities,documents,refresh,notify}:{fill:FillSession;issues:ReviewIssue[];claims:Claim[];entities:Entity[];documents:UploadedDocument[];refresh:()=>Promise<void>;notify:(v:Toast)=>void}) {
  const [selectedId,setSelectedId]=useState(issues.find(i=>i.status==='open')?.id??issues[0]?.id??null);const issue=issues.find(i=>i.id===selectedId);const [manual,setManual]=useState('');const [working,setWorking]=useState(false)
  const resolve=async(action:string,claimId?:string)=>{if(!issue)return;setWorking(true);try{await api.resolveIssue(fill.id,issue.id,{action,selected_claim_id:claimId,manual_value:action==='manual_edit'?manual:undefined,actor:'reviewer',reason:'Reviewer decision from evidence review'});await refresh();notify({kind:'success',text:'Review decision recorded.'})}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Could not save decision.'})}finally{setWorking(false)}}
  const candidates=issue?claims.filter(c=>issue.candidate_claim_ids.includes(c.id)):[]
  return <div className="review-layout"><aside className="issue-list"><div className="section-heading compact"><div><p className="eyebrow">Review queue</p><h2>{issues.filter(i=>i.status==='open').length} open issues</h2></div></div>{issues.length===0?<EmptyState icon={Check} title="No issues" text="All mapped values are supported under the current rules."/>:issues.map((item,i)=><button key={item.id} className={selectedId===item.id?'issue-item active':'issue-item'} onClick={()=>setSelectedId(item.id)}><span>{String(i+1).padStart(2,'0')}</span><div><strong>{statusLabel(item.issue_type)}</strong><small>{item.attribute?statusLabel(item.attribute):item.reason}</small></div><Status value={item.status}/></button>)}</aside><section className="issue-detail">{!issue?<EmptyState icon={AlertCircle} title="Select an issue" text="Choose an item from the review queue to inspect its evidence."/>:<><div className="issue-heading"><div><p className="eyebrow">{statusLabel(issue.issue_type)}</p><h2>{issue.attribute?statusLabel(issue.attribute):'Evidence review'}</h2><p>{issue.reason}</p></div><Status value={issue.status}/></div><div className="candidate-grid">{candidates.map(c=>{const source=documents.find(d=>d.id===c.document_id);return <article className="candidate" key={c.id}><div className="candidate-top"><span>Source candidate</span><Status value={c.entity_link_status}/></div><strong>{c.value_raw}</strong><blockquote>{c.observed_text}</blockquote><dl><div><dt>Subject</dt><dd>{entities.find(e=>e.id===c.entity_id)?.display_name||statusLabel(c.entity_role||'Unconfirmed')}</dd></div><div><dt>Source</dt><dd>{source?.original_filename||'Unknown document'} · Page {c.page_index+1}</dd></div></dl>{source?.classification?.reasoning&&<details className="reasoning-log"><summary>Model reasoning</summary><pre>{source.classification.reasoning}</pre></details>}{issue.status==='open'&&<button className="button full" disabled={working} onClick={()=>resolve('choose_claim',c.id)}>Choose this evidence</button>}</article>})}</div>{issue.status==='open'&&<div className="manual-resolution"><label>Manual correction<input value={manual} onChange={e=>setManual(e.target.value)} placeholder="Enter a verified value"/></label><button className="button button--primary" disabled={!manual||working} onClick={()=>resolve('manual_edit')}>Use manual value</button><button className="text-button" disabled={working} onClick={()=>resolve('mark_unresolved')}>Leave unresolved</button></div>}</>}</section></div>
}

function ReviewStageV2({fill,template,issues,claims,entities,documents,refresh,notify}:{fill:FillSession;template:FormTemplate;issues:ReviewIssue[];claims:Claim[];entities:Entity[];documents:UploadedDocument[];refresh:()=>Promise<void>;notify:(v:Toast)=>void}) {
  const documentReviews=documents.filter(document=>document.status==='needs_review'||document.status==='wrong_type')
  const reviewIssues=issues.filter(item=>item.issue_type!=='wrong_document_type')
  const firstSelection=documentReviews[0]?`document:${documentReviews[0].id}`:reviewIssues.find(item=>item.status==='open')?.id??reviewIssues[0]?.id??null
  const [selectedId,setSelectedId]=useState<string|null>(firstSelection)
  const [manualDrafts,setManualDrafts]=useState<Record<string,string>>({})
  const [typeDrafts,setTypeDrafts]=useState<Record<string,string>>({})
  const [working,setWorking]=useState(false)
  const selectedDocument=selectedId?.startsWith('document:')?documents.find(document=>`document:${document.id}`===selectedId):undefined
  const issue=selectedId?.startsWith('document:')?undefined:reviewIssues.find(item=>item.id===selectedId)
  const manual=issue?manualDrafts[issue.id]??'':''
  const selectedType=selectedDocument?typeDrafts[selectedDocument.id]??selectedDocument.type_key??'':''
  const selectionKey=[...documentReviews.map(document=>`document:${document.id}`),...reviewIssues.map(item=>item.id)].join('|')
  useEffect(()=>{const validSelections=selectionKey?selectionKey.split('|'):[];if(!selectedId||!validSelections.includes(selectedId))setSelectedId(validSelections[0]??null)},[selectedId,selectionKey])

  const resolve=async(action:string,claimId?:string)=>{
    if(!issue)return
    setWorking(true)
    try{
      await api.resolveIssue(fill.id,issue.id,{action,selected_claim_id:claimId,manual_value:action==='manual_edit'?manual:undefined,actor:'reviewer',reason:'Reviewer decision from evidence review'})
      setManualDrafts(current=>{const next={...current};delete next[issue.id];return next})
      await refresh()
      notify({kind:'success',text:'Review decision recorded.'})
    }catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Could not save decision.'})}finally{setWorking(false)}
  }
  const confirmType=async()=>{
    if(!selectedDocument||!selectedType)return
    setWorking(true)
    try{
      await api.confirmDocumentType(fill.id,selectedDocument.id,selectedType)
      await refresh()
      notify({kind:'success',text:'Document type confirmed. Extraction from this document has started.'})
    }catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Could not confirm the document type.'})}finally{setWorking(false)}
  }
  const candidates=issue?claims.filter(claim=>issue.candidate_claim_ids.includes(claim.id)):[]
  const openCount=documentReviews.length+reviewIssues.filter(item=>item.status==='open').length
  const totalItems=documentReviews.length+reviewIssues.length

  return <div className="review-layout"><aside className="issue-list"><div className="section-heading compact"><div><p className="eyebrow">Review queue</p><h2>{openCount} open issues</h2></div></div>{totalItems===0?<EmptyState icon={Check} title="No issues" text="All mapped values are supported under the current rules."/>:<>{documentReviews.map((document,index)=><button key={document.id} className={selectedId===`document:${document.id}`?'issue-item active':'issue-item'} onClick={()=>setSelectedId(`document:${document.id}`)}><span>{String(index+1).padStart(2,'0')}</span><div><strong>Document Type Review</strong><small>{document.original_filename}</small></div><Status value="needs_review"/></button>)}{reviewIssues.map((item,index)=><button key={item.id} className={selectedId===item.id?'issue-item active':'issue-item'} onClick={()=>setSelectedId(item.id)}><span>{String(documentReviews.length+index+1).padStart(2,'0')}</span><div><strong>{statusLabel(item.issue_type)}</strong><small>{item.attribute?statusLabel(item.attribute):item.reason}</small></div><Status value={item.status}/></button>)}</>}</aside><section className="issue-detail">{selectedDocument?<><div className="issue-heading"><div><p className="eyebrow">Document type review</p><h2>{selectedDocument.original_filename}</h2><p>The model could not verify this document type confidently. Select its type before any values are extracted from it.</p></div><Status value="needs_review"/></div><div className="document-type-review"><div className="document-type-preview"><img src={`/api/fills/${fill.id}/documents/${selectedDocument.id}/pages/0/preview`} alt={`First page of ${selectedDocument.original_filename}`}/></div><div className="document-type-details"><p className="eyebrow">Stored model context</p><p>{selectedDocument.classification?.summary||'No reliable document summary was returned.'}</p>{selectedDocument.classification?.reasoning&&<details className="reasoning-log"><summary>Model reasoning</summary><pre>{selectedDocument.classification.reasoning}</pre></details>}</div></div><div className="manual-resolution document-type-resolution"><label>Confirmed document type<select value={selectedType} onChange={event=>setTypeDrafts(current=>({...current,[selectedDocument.id]:event.target.value}))}><option value="">Select a document type</option>{template.requirements?.map(requirement=><option key={requirement.type_key} value={requirement.type_key}>{requirement.label}</option>)}</select></label><button className="button button--primary" disabled={!selectedType||working} onClick={confirmType}>{working?<LoaderCircle className="spin" size={17}/>:null}Confirm type &amp; extract</button></div></>:issue?<><div className="issue-heading"><div><p className="eyebrow">{statusLabel(issue.issue_type)}</p><h2>{issue.attribute?statusLabel(issue.attribute):'Evidence review'}</h2><p>{issue.reason}</p></div><Status value={issue.status}/></div><div className="candidate-grid">{candidates.map(candidate=>{const source=documents.find(document=>document.id===candidate.document_id);return <article className="candidate" key={candidate.id}><div className="candidate-top"><span>Source candidate</span><Status value={candidate.entity_link_status}/></div><strong>{candidate.value_raw}</strong><blockquote>{candidate.observed_text}</blockquote><dl><div><dt>Subject</dt><dd>{entities.find(entity=>entity.id===candidate.entity_id)?.display_name||statusLabel(candidate.entity_role||'Unconfirmed')}</dd></div><div><dt>Source</dt><dd>{source?.original_filename||'Unknown document'} · Page {candidate.page_index+1}</dd></div></dl>{source?.classification?.reasoning&&<details className="reasoning-log"><summary>Model reasoning</summary><pre>{source.classification.reasoning}</pre></details>}{issue.status==='open'&&<button className="button full" disabled={working} onClick={()=>resolve('choose_claim',candidate.id)}>Choose this evidence</button>}</article>})}</div>{issue.status==='open'&&<div className="manual-resolution"><label>Manual correction<input key={issue.id} value={manual} onChange={event=>setManualDrafts(current=>({...current,[issue.id]:event.target.value}))} placeholder="Enter a verified value"/></label><button className="button button--primary" disabled={!manual||working} onClick={()=>resolve('manual_edit')}>Use manual value</button><button className="text-button" disabled={working} onClick={()=>resolve('mark_unresolved')}>Leave unresolved</button></div>}</>:<EmptyState icon={AlertCircle} title="Select an issue" text="Choose an item from the review queue to inspect its evidence."/>}</section></div>
}

function LegacyFilledStage({fill,template,decisions,refresh,notify}:{fill:FillSession;template:FormTemplate;decisions:Decision[];refresh:()=>Promise<void>;notify:(v:Toast)=>void}) {
  const [selected,setSelected]=useState<string|null>(template.fields?.[0]?.id??null);const field=template.fields?.find(f=>f.id===selected);const decision=decisions.find(d=>d.field_id===selected);const [value,setValue]=useState('')
  useEffect(()=>setValue(decision?.resolved_value??''),[decision?.resolved_value])
  const save=async()=>{if(!field)return;try{await api.overrideField(fill.id,field.id,value||null);await refresh();notify({kind:'success',text:'Field override saved to the audit trail.'})}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Save failed.'})}}
  return <div className="filled-layout"><aside className="filled-fields"><p className="eyebrow">Final field state</p>{template.fields?.map((f,i)=>{const d=decisions.find(x=>x.field_id===f.id);return <button key={f.id} className={selected===f.id?'active':''} onClick={()=>setSelected(f.id)}><span>{String(i+1).padStart(2,'0')}</span><div><strong>{f.display_label}</strong><small>{d?.resolved_value||'No supported value'}</small></div><Status value={d?.status||'unresolved'}/></button>})}</aside><section className="document-stage"><div className="stage-bar"><span>Final preview · Page 1 of {template.page_count}</span><span>{decisions.filter(d=>d.status==='unresolved').length} unresolved</span></div><div className="pdf-frame"><iframe title="Final form preview" src={`/api/templates/${template.id}/file#toolbar=0&navpanes=0`}/>{template.fields?.map(f=>{const d=decisions.find(x=>x.field_id===f.id);if(!d?.resolved_value||f.page_index!==0)return null;return <button key={f.id} onClick={()=>setSelected(f.id)} className={`value-overlay ${selected===f.id?'active':''}`} style={{left:`${f.bbox_norm[0]*100}%`,top:`${f.bbox_norm[1]*100}%`,width:`${(f.bbox_norm[2]-f.bbox_norm[0])*100}%`,height:`${(f.bbox_norm[3]-f.bbox_norm[1])*100}%`}}>{d.resolved_value}</button>})}</div></section><aside className="properties-panel"><div className="properties-content">{field?<><div className="properties-heading"><div><p className="eyebrow">Final value</p><h2>{field.display_label}</h2></div></div><Status value={decision?.status||'unresolved'}/><div className="property-form"><label>Value<input value={value} onChange={e=>setValue(e.target.value)} placeholder="Leave blank if unsupported"/></label><label>Target<input value={field.semantic_target} disabled/></label></div><div className="panel-footer"><button className="button button--primary full" onClick={save}>Save manual value</button><p className="fine-print">Manual changes are explicit overrides and never rewrite the original extracted claim.</p></div></>:<p>Select a field.</p>}</div></aside></div>
}

function FilledStage({fill,template,decisions,claims,entities,documents,refresh,notify}:{fill:FillSession;template:FormTemplate;decisions:Decision[];claims:Claim[];entities:Entity[];documents:UploadedDocument[];refresh:()=>Promise<void>;notify:(v:Toast)=>void}) {
  const [selected,setSelected]=useState<string|null>(template.fields?.[0]?.id??null)
  const [page,setPage]=useState(template.fields?.[0]?.page_index??0)
  const field=template.fields?.find(item=>item.id===selected)
  const decision=decisions.find(item=>item.field_id===selected)
  const selectedClaim=claims.find(item=>item.id===decision?.selected_claim_id)
  const sourceDocument=documents.find(item=>item.id===selectedClaim?.document_id)
  const [value,setValue]=useState('')
  const [sourceIndexOpen,setSourceIndexOpen]=useState(false)
  useEffect(()=>setValue(decision?.resolved_value??''),[decision?.resolved_value])
  const selectField=(next:FormField)=>{setSelected(next.id);setPage(next.page_index);setSourceIndexOpen(false)}
  const save=async()=>{if(!field)return;try{await api.overrideField(fill.id,field.id,value||null);await refresh();notify({kind:'success',text:'Field override saved to the audit trail.'})}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Save failed.'})}}
  const pageFields=(template.fields??[]).filter(item=>item.page_index===page)
  const sourceGroups=new Map<string,{label:string;document:UploadedDocument|null;page:number|null;fields:FormField[]}>()
  for(const item of template.fields??[]){const itemDecision=decisions.find(candidate=>candidate.field_id===item.id);const claim=claims.find(candidate=>candidate.id===itemDecision?.selected_claim_id);const document=documents.find(candidate=>candidate.id===claim?.document_id)??null;const key=document&&claim?`${document.id}:${claim.page_index}`:'unlinked';const label=document&&claim?`${document.original_filename} · Page ${claim.page_index+1}`:'Manual or unresolved';const group=sourceGroups.get(key)??{label,document,page:claim?.page_index??null,fields:[]};group.fields.push(item);sourceGroups.set(key,group)}
  return <div className="filled-layout filled-layout--evidence">
    <button className={`source-index-toggle ${sourceIndexOpen?'open':''}`} onClick={()=>setSourceIndexOpen(open=>!open)} aria-expanded={sourceIndexOpen} aria-controls="filled-source-index">{sourceIndexOpen?<ChevronLeft size={16}/>:<ChevronRight size={16}/>}<span>{sourceIndexOpen?'Close fields':'Fields'}</span></button>
    {sourceIndexOpen&&<button className="source-index-scrim" onClick={()=>setSourceIndexOpen(false)} aria-label="Close fields panel"/>}
    <aside id="filled-source-index" className={`filled-source-index ${sourceIndexOpen?'open':''}`}><div className="source-index-heading"><p className="eyebrow">Extracted fields</p><strong>{template.fields?.length??0} fields</strong></div>{Array.from(sourceGroups.entries()).map(([key,group])=><section className="source-field-group" key={key}><div><strong>{group.document?.original_filename||'No evidence source'}</strong><span>{group.page===null?'Manual or unresolved':`Page ${group.page+1}`} · {group.fields.length}</span></div>{group.fields.map(item=>{const itemDecision=decisions.find(candidate=>candidate.field_id===item.id);return <button key={item.id} className={selected===item.id?'active':''} onClick={()=>selectField(item)} title={item.display_label}><span>{item.display_label}</span><i className={itemDecision?.status==='auto_supported'?'supported':''}/></button>})}</section>)}</aside>
    <section className="document-stage filled-preview"><div className="mapping-toolbar filled-preview-toolbar"><div className="page-controls"><button onClick={()=>setPage(Math.max(0,page-1))} disabled={page===0} aria-label="Previous form page"><ChevronLeft size={16}/></button><span>Form {page+1} / {template.page_count}</span><button onClick={()=>setPage(Math.min(template.page_count-1,page+1))} disabled={page===template.page_count-1} aria-label="Next form page"><ChevronRight size={16}/></button></div><span className="preview-status">Filled form</span></div><div className="mapping-scroll"><div className="mapping-page filled-preview-page"><img src={`/api/templates/${template.id}/pages/${page}/preview`} draggable={false} alt={`Filled form page ${page+1}`}/><div className="filled-value-layer">{pageFields.map(item=>{const itemDecision=decisions.find(candidate=>candidate.field_id===item.id);if(!itemDecision?.resolved_value)return null;const shown=item.field_type==='checkbox'&&itemDecision.resolved_value.toLowerCase()==='yes'?'✓':itemDecision.resolved_value;return <button key={item.id} onClick={()=>selectField(item)} className={`value-overlay ${selected===item.id?'active':''}`} style={{left:`${item.bbox_norm[0]*100}%`,top:`${item.bbox_norm[1]*100}%`,width:`${(item.bbox_norm[2]-item.bbox_norm[0])*100}%`,height:`${(item.bbox_norm[3]-item.bbox_norm[1])*100}%`}}>{shown}</button>})}</div></div></div></section>
    <section className="document-stage source-evidence"><div className="mapping-toolbar source-evidence-toolbar"><div><span>Evidence source</span><strong>{sourceDocument?.original_filename||'No linked source'}</strong></div>{selectedClaim&&<span>Page {selectedClaim.page_index+1}</span>}</div>{selectedClaim&&sourceDocument?<div className="mapping-scroll"><div className="mapping-page source-evidence-page"><img src={`/api/fills/${fill.id}/documents/${sourceDocument.id}/pages/${selectedClaim.page_index}/preview`} draggable={false} alt={`${sourceDocument.original_filename}, page ${selectedClaim.page_index+1}`}/></div></div>:<div className="source-empty"><FileCheck2 size={24}/><strong>No single source page</strong><p>This field is manual, unresolved, or supported by document-presence policy.</p></div>}</section>
  </div>
  /* Previous single-document inspector retained only in source history.
  return <div className="filled-layout">
    <aside className="filled-fields"><p className="eyebrow">Final field state</p>{template.fields?.map((item,index)=>{const itemDecision=decisions.find(candidate=>candidate.field_id===item.id);return <button key={item.id} className={selected===item.id?'active':''} onClick={()=>selectField(item)}><span>{String(index+1).padStart(2,'0')}</span><div><strong>{item.display_label}</strong><small>Page {item.page_index+1} · {itemDecision?.resolved_value||'No supported value'}</small></div><Status value={itemDecision?.status||'unresolved'}/></button>})}</aside>
    <section className="document-stage filled-preview"><div className="mapping-toolbar filled-preview-toolbar"><div className="page-controls"><button onClick={()=>setPage(Math.max(0,page-1))} disabled={page===0} aria-label="Previous page"><ChevronLeft size={16}/></button><span>Page {page+1} of {template.page_count}</span><button onClick={()=>setPage(Math.min(template.page_count-1,page+1))} disabled={page===template.page_count-1} aria-label="Next page"><ChevronRight size={16}/></button></div><span className="preview-status">{decisions.filter(item=>item.status==='unresolved').length} unresolved</span></div><div className="mapping-scroll"><div className="mapping-page filled-preview-page"><img src={`/api/templates/${template.id}/pages/${page}/preview`} draggable={false} alt={`Filled form page ${page+1}`}/><div className="filled-value-layer">{pageFields.map(item=>{const itemDecision=decisions.find(candidate=>candidate.field_id===item.id);if(!itemDecision?.resolved_value)return null;const shown=item.field_type==='checkbox'&&itemDecision.resolved_value.toLowerCase()==='yes'?'✓':itemDecision.resolved_value;return <button key={item.id} onClick={()=>selectField(item)} title={`${item.display_label}: ${itemDecision.resolved_value}`} className={`value-overlay ${selected===item.id?'active':''}`} style={{left:`${item.bbox_norm[0]*100}%`,top:`${item.bbox_norm[1]*100}%`,width:`${(item.bbox_norm[2]-item.bbox_norm[0])*100}%`,height:`${(item.bbox_norm[3]-item.bbox_norm[1])*100}%`}}>{shown}</button>})}</div></div></div></section>
    <aside className="properties-panel"><div className="properties-content">{field?<><div className="properties-heading"><div><p className="eyebrow">Final value</p><h2>{field.display_label}</h2></div></div><Status value={decision?.status||'unresolved'}/><div className="property-form"><label>Value<input value={value} onChange={e=>setValue(e.target.value)} placeholder="Leave blank if unsupported"/></label><label>Target<input value={field.semantic_target} disabled/></label></div><section className="field-provenance"><p className="eyebrow">Source &amp; decision</p>{selectedClaim?<><dl><div><dt>Source document</dt><dd>{sourceDocument?.original_filename||'Unknown document'}</dd></div><div><dt>Source page</dt><dd>Page {selectedClaim.page_index+1}</dd></div><div><dt>Linked entity</dt><dd>{sourceEntity?.display_name||statusLabel(selectedClaim.entity_role||'Unconfirmed')}</dd></div><div><dt>Decision method</dt><dd>{statusLabel(decision?.status||'unresolved')}</dd></div><div><dt>Reason</dt><dd>{decision?.reason_code?statusLabel(decision.reason_code):'Direct supported evidence'}</dd></div></dl><blockquote>{selectedClaim.observed_text}</blockquote>{sourceDocument?.classification?.reasoning&&<details className="reasoning-log"><summary>View stored Muse reasoning</summary><pre>{sourceDocument.classification.reasoning}</pre></details>}</>:decision?.human_override?<p className="provenance-note">This value was entered manually by a reviewer. The original extracted claims remain unchanged in the audit trail.</p>:decision?.status==='auto_supported'?<p className="provenance-note">This field was supported by document presence or a deterministic policy and does not reference a single extracted text claim.</p>:<p className="provenance-note">No supported source claim has been selected for this field.</p>}</section><div className="panel-footer"><button className="button button--primary full" onClick={save}>Save manual value</button><p className="fine-print">Manual changes are explicit overrides and never rewrite the original extracted claim.</p></div></>:<p>Select a field.</p>}</div></aside>
  </div>
  */
}

function AuditStage({fill,issues,audit,notify}:{fill:FillSession;issues:ReviewIssue[];audit:AuditEvent[];notify:(v:Toast)=>void}) {
  const [working,setWorking]=useState(false);const open=issues.filter(i=>i.status==='open').length
  const exportPdf=async()=>{setWorking(true);try{const artifact=await api.export(fill.id,open>0);window.open(`/api/fills/${fill.id}/exports/${artifact.id}`,'_blank');notify({kind:'success',text:open?'Draft export generated with unresolved items noted.':'Reviewed PDF export generated.'})}catch(e){notify({kind:'error',text:e instanceof Error?e.message:'Export failed.'})}finally{setWorking(false)}}
  return <div className="audit-layout"><section className="export-panel"><p className="eyebrow">Export readiness</p><h2>{open?`${open} unresolved ${open===1?'item':'items'}`:'Ready to export'}</h2><p>{open?'You may export a clearly marked draft. Resolve all open issues before treating the form as reviewed.':'All review issues are closed. The PDF will reflect the current final field state.'}</p><dl className="export-summary"><div><dt>Template version</dt><dd>{fill.template_version}</dd></div><div><dt>Fill status</dt><dd>{statusLabel(fill.status)}</dd></div><div><dt>Audit events</dt><dd>{audit.length}</dd></div></dl><button className="button button--primary full" onClick={exportPdf} disabled={working}>{working?<LoaderCircle className="spin" size={17}/>:<Download size={17}/>}Download {open?'draft':'filled'} PDF</button></section><section className="timeline"><div className="section-heading"><div><p className="eyebrow">Immutable activity</p><h2>Audit timeline</h2></div></div>{audit.length===0?<EmptyState icon={Clock3} title="No activity recorded" text="Processing and review actions will appear here."/>:audit.map(event=><div className="timeline-row" key={event.id}><span className="timeline-mark"/><time>{new Date(event.timestamp).toLocaleString()}</time><div><strong>{statusLabel(event.action)}</strong><p>{event.reason||`${statusLabel(event.actor)} updated ${statusLabel(event.target_type)}.`}</p></div></div>)}</section></div>
}

export default App
