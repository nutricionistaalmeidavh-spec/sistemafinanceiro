import { memo, useEffect, useState } from 'react';

type Attachment = EntryAttachmentRecord;
type Props = {
  item: Attachment;
  editable: boolean;
  confidence?: number | null;
  onCorrect: (id:string,text:string)=>Promise<void>;
  onReview: (id:string)=>Promise<void>;
};
function AttachmentOcrEditor({ item, editable, confidence, onCorrect, onReview }: Props) {
  const [draft,setDraft]=useState(item.extracted_text||'');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{setDraft(item.extracted_text||'');setError('');},[item.id,item.extracted_text]);
  const changed=draft!==(item.extracted_text||'');
  async function save(){
    if(!editable||busy||!changed)return;
    setBusy(true);setError('');
    try{await onCorrect(item.id,draft);}catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  async function review(){
    if(busy||changed||!editable||item.review_status==='REVIEWED')return;
    setBusy(true);setError('');
    try{await onReview(item.id);}catch(err){setError(err instanceof Error?err.message:String(err));}
    finally{setBusy(false);}
  }
  return <div className="nested-form" style={{padding:'8px 0'}}>
    <label className="wide"><span>Conferência do texto OCR — {item.filename}</span>
      <textarea rows={4} value={draft} readOnly={!editable} onChange={event=>setDraft(event.target.value)}
        aria-label={'Editar texto OCR de '+item.filename} placeholder="Execute o OCR para extrair o texto do anexo."/>
    </label>
    {(confidence??item.ocr_confidence)!=null&&<small className="muted">Confiança do OCR nesta sessão: {Math.round(Number(confidence??item.ocr_confidence)*100)}%</small>}
    <div className="inline-actions">
      {editable&&<button type="button" className="secondary-button small" disabled={!changed||busy||!draft.trim()} onClick={()=>void save()}>Salvar correção auditada</button>}
      {editable&&<button type="button" className="primary-button small" disabled={changed||busy||!draft.trim()||item.review_status==='REVIEWED'} onClick={()=>void review()}>
        {item.review_status==='REVIEWED'?'Revisado':'Confirmar revisão'}
      </button>}
    </div>
    {changed&&<small className="muted">Salve a correção antes de confirmar a revisão.</small>}
    {error&&<div className="error-box" role="alert">{error}</div>}
  </div>;
}
export default memo(AttachmentOcrEditor);
