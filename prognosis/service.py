"""Bounded OpenRouter search, with memory-only caching and no prompt logging."""
import calendar
import copy
import datetime as dt
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'mocks' / 'src' / 'data'
PROMPT = (Path(__file__).parent / 'prompt.txt').read_text()
ENDPOINTS = ('os_6','os_12','os_36','os_60','pfs','orr','dor','toxicity_grade3','discontinuation_toxicity','burden')
WEIGHTS = {'histology':25,'stage':15,'biomarkers':15,'treatment_line':15,'prior_treatment':10,'performance_status':10,'brain_metastases':5,'age':5}
MODEL_ENV = (('OPENROUTER_MODEL_ASTRA','GPT Astra'),)
MAX_RESPONSE = 2_000_000

class Problem(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message); self.code=code; self.message=message; self.status=status


def load_env(path=None):
    """Minimal dotenv reader; environment wins. Never logs or returns secrets."""
    path = path or ROOT / '.env'
    if path.exists():
        for line in path.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key,value=line.split('=',1)
                if re.fullmatch(r'[A-Z][A-Z0-9_]*',key.strip()):
                    os.environ.setdefault(key.strip(),value.strip().strip('\"\''))


def date_end(value):
    """Upper bound of original precision, so a partly future month is excluded."""
    if not isinstance(value,str): return None
    value=value.strip()
    if not value: return None
    # Ranges require every mentioned boundary and use the latest date.
    if re.search(r'\s(?:až|do|–)\s',value):
        parts=re.split(r'\s(?:až|do|–)\s',value)
        ends=[date_end(x) for x in parts]
        return max(ends) if ends and all(ends) else None
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}',value): return dt.date.fromisoformat(value)
        if re.fullmatch(r'\d{4}-\d{2}',value): y,m=map(int,value.split('-')); return dt.date(y,m,calendar.monthrange(y,m)[1])
        if re.fullmatch(r'\d{4}',value): return dt.date(int(value),12,31)
        m=re.fullmatch(r'(\d{1,2})\.(\d{1,2})\.(\d{4})',value)
        if m: day,month,year=map(int,m.groups()); return dt.date(year,month,day)
        m=re.fullmatch(r'(\d{1,2})/(\d{2}|\d{4})',value)
        if m:
            month,year=map(int,m.groups()); year=2000+year if year<100 else year
            return dt.date(year,month,calendar.monthrange(year,month)[1])
    except ValueError: return None
    return None


def clean_text(text, forbidden=()):
    if not isinstance(text,str): return ''
    for name in sorted(set(forbidden),key=len,reverse=True):
        if name: text=re.sub(re.escape(name),'[odstraněný identifikátor]',text,flags=re.I)
    text=re.sub(r'\b\d{6}\s*/\s*\d{3,4}\b','[odstraněné RČ]',text)
    text=re.sub(r'\b(?:MUDr\.|Mgr\.|Ing\.|Bc\.)\s+[^,;()\n]+','[odstraněný autor]',text)
    text=re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}','[odstraněný kontakt]',text)
    return text[:4000]


def profile_for(patient_id, scheduled_date):
    if not isinstance(patient_id,str) or patient_id not in {'10_pacient.pdf','S01_pacient.pdf'}:
        raise Problem('unsupported_patient','Pro tento případ zatím chybí bezpečně datovaný klinický profil.',422)
    if not isinstance(scheduled_date,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',scheduled_date):
        raise Problem('invalid_date','Vyberte datum naplánovaného MDT.')
    try: cutoff=dt.date.fromisoformat(scheduled_date)
    except ValueError: raise Problem('invalid_date','Datum MDT není platné.')
    case=json.loads((DATA/('mock-case-10.json' if patient_id.startswith('10_') else 'mock-case-S01.json')).read_text())
    people=case.get('patient',{})
    entry=case.get('list_entry',{})
    forbidden=[people.get('name',''),people.get('name_as_written',''),entry.get('name',''),entry.get('owner',''),case.get('others_entry',{}).get('referring_doctor','')]
    facts=[]; excluded=0; future=0
    def add(text,date,source,kind='clinical',status='documented',certainty='documented'):
        nonlocal excluded,future
        end=date_end(date)
        if end is None: excluded+=1; return
        if end>cutoff: future+=1; return
        # A fact dated at treatment start can describe its later end or follow-up.
        embedded=re.findall(r'(?<![\d])(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}/(?:\d{4}|\d{2}))(?![\d])',str(text or '')+' '+str(source.get('quote','')))
        if any(date_end(x) and date_end(x)>cutoff for x in embedded): future+=1; return
        text=clean_text(text,forbidden)
        if text:
            facts.append({'text':text,'date':date,'source':{'page':source.get('page'),'quote':clean_text(source.get('quote',''),forbidden)},'kind':kind,'status':status,'certainty':certainty})
    if patient_id.startswith('10_'):
        for event in case.get('timeline',[]):
            # Use full original date including ranges, not only date_sort's start.
            add(event.get('label_cs'),event.get('date'),event.get('source',{}),event.get('type','clinical'),event.get('status','documented'))
        for kind,items in case.get('sections',{}).items():
            if isinstance(items,list):
                for item in items:
                    if isinstance(item,dict): add(item.get('text_cs'),item.get('date'),item.get('source',{}),kind,certainty=item.get('certainty','documented'))
        extra=json.loads((DATA/'mock-case-10-extra.json').read_text())
        for kind in ('OA','FA','AA'):
            for item in extra.get('anamnesis',{}).get(kind,[]):
                add(item.get('text_cs'),item.get('date'),item.get('source',{}),'anamnesis',certainty=item.get('certainty','documented'))
    else:
        page_dates={page:doc['date'] for doc in case['documents'] for page in doc['pages']}
        other=case['others_entry']
        for key,source_key in [('diagnosis_cs','diagnosis_source'),('mkn10','mkn10_source')]:
            source=other.get(source_key,{})
            add(other.get(key),page_dates.get(source.get('page')),source,'diagnosis')
        source=other.get('histology_source',{})
        add(source.get('quote'),page_dates.get(source.get('page')),source,'histology')
        # Whole summary can only be used once its source document exists by cutoff.
        add(entry.get('one_line_summary_cs'),page_dates.get(1),{'page':1,'quote':entry.get('one_line_summary_cs','')},'summary')
        add(entry.get('mdt_question_cs'),page_dates.get(2),entry.get('mdt_question_source',{}),'question','question')
        # Fixed, organizer/team synthetic notes only; extract clinical sections,
        # never identity headers or author/footer blocks. Date is source availability.
        clinical_sections={'Závěr','Subjektivně','Objektivně','Medikace','Anamnéza','Zhodnocení','Doporučení','Diagnózy'}
        for filename,document_date,start_page in [('05-ambulantni-vstupni-2026-01-08.md','2026-01-08',6),('01-ambulantni-kontrolni-2026-10-06.md','2026-10-06',1)]:
            if dt.date.fromisoformat(document_date)>cutoff:continue
            note=ROOT/'samples'/'S01_pacient'/filename
            if not note.is_file():continue
            section=None;page=start_page
            for line in note.read_text().splitlines():
                line=line.strip()
                if '<!-- page -->' in line:page+=1;continue
                heading=re.match(r'^\*([^*]+):\*\s*(.*)$',line)
                if heading:
                    section=heading.group(1) if heading.group(1) in clinical_sections else None
                    line=heading.group(2)
                if not section or not line or 'nar.' in line or line.startswith(('MUDr.','#')) or line.startswith('SA:'):continue
                if section=='Anamnéza' and line.startswith('SA:'):continue
                text=line.lstrip('- ').strip('*')
                add(text,document_date,{'page':page,'quote':text},'clinical_note:'+section,'planned' if section=='Doporučení' else 'documented')
        # Latest dated lab result for each test, with original units and quote.
        for test in case.get('labs_series',{}).get('tests',[]):
            points=[point for point in test.get('points',[]) if date_end(point.get('date')) and date_end(point['date'])<=cutoff]
            if points:
                point=max(points,key=lambda x:date_end(x['date']))
                text=test.get('code','')+': '+str(point.get('value'))+' '+test.get('unit','')+'; referenční rozmezí '+test.get('reference_range','')
                add(text,point['date'],point.get('source',{}),'laboratory',certainty=point.get('certainty','documented'))
    seen=set(); facts=[x for x in facts if not ((x['text'],x['date']) in seen or seen.add((x['text'],x['date'])))]
    if not facts: raise Problem('empty_profile','K datu MDT nejsou dostupné bezpečně datované údaje.',422)
    return {'available':True,'included_count':len(facts),'synthetic':True,'scheduled_date':scheduled_date,'facts':facts,'excluded_undated':excluded,'excluded_after_cutoff':future,'warnings':[f'Vynecháno {excluded} nedatovaných a {future} údajů přesahujících datum MDT.','Nedatované údaje jsou vynechány. Profil nemusí obsahovat aktuální ECOG, věk ani všechny komorbidity.' if patient_id.startswith('10_') else 'Klinické údaje pocházejí z datovaných syntetických zpráv. Věk a další nedoložené údaje nejsou odhadnuty.','Historický stav neprokazuje aktuální stav. Plánovaná léčba není podaná léčba.']}


def safe_url(value):
    if not isinstance(value,str) or len(value)>2000: return None
    try:
        p=urllib.parse.urlsplit(value)
        if p.scheme!='https' or not p.hostname or p.username or p.password or p.port not in (None,443): return None
        if not re.fullmatch(r'[A-Za-z0-9.-]+',p.hostname) or '.' not in p.hostname: return None
        if p.hostname in ('localhost','127.0.0.1') or re.fullmatch(r'[\d.]+',p.hostname): return None
        return value
    except ValueError: return None


def url_key(value):
    parsed=urllib.parse.urlsplit(value)
    query=urllib.parse.urlencode(sorted((k,v) for k,v in urllib.parse.parse_qsl(parsed.query,keep_blank_values=True) if not k.lower().startswith('utm_') and k.lower() not in ('gclid','fbclid')))
    return (parsed.hostname or '').lower()+parsed.path.rstrip('/')+('?' + query if query else '')


def excerpt_citations(message):
    citations={}
    annotations=message.get('annotations',[])
    if not isinstance(annotations,list):return citations
    for annotation in annotations:
        if not isinstance(annotation,dict) or annotation.get('type')!='url_citation':continue
        citation=annotation.get('url_citation')
        if not isinstance(citation,dict) or not safe_url(citation.get('url')):continue
        content=citation.get('content')
        if not isinstance(content,str) or not content.strip():continue
        # Never synthesize a quote across separate search excerpts.
        chunks=[re.sub(r'\s+',' ',chunk).strip() for chunk in content.split('[...]')]
        citations.setdefault(url_key(citation['url']),[]).extend(x for x in chunks if x)
    return citations


def quoted(quote, chunks):
    return isinstance(quote,str) and bool(quote.strip()) and any(re.sub(r'\s+',' ',quote).strip() in chunk for chunk in chunks)


def normalize_row(raw, model, profile, citations=None):
    if not isinstance(raw,dict): return None
    source=raw.get('source')
    if not isinstance(source,dict) or not safe_url(source.get('url')): return None
    source_key=url_key(source['url'])
    if citations is not None and source_key not in citations:return None
    title=raw.get('study_title');arm=raw.get('arm');population=raw.get('population')
    if not all(isinstance(x,str) and x.strip() for x in (title,arm,population)): return None
    year=source.get('year'); published=source.get('published_date')
    cutoff=dt.date.fromisoformat(profile['evidence_cutoff'])
    if not isinstance(year,int) or isinstance(year,bool) or year<1900 or year>cutoff.year: return None
    if not published and dt.date(year,12,31)>cutoff:return None
    if published:
        try:
            if dt.date.fromisoformat(published)>cutoff:return None
        except (ValueError,TypeError):return None
    endpoints={}; missing=0
    for key in ENDPOINTS:
        e=(raw.get('endpoints') or {}).get(key)
        if not isinstance(e,dict) or not isinstance(e.get('quote'),str) or len(e['quote'].strip())<12 or not safe_url(e.get('source_url')):
            endpoints[key]=None;continue
        # All endpoints must reference this dated publication; independent later
        # follow-ups require their own row and publication cutoff.
        if url_key(e['source_url'])!=source_key:endpoints[key]=None;continue
        if citations is not None and not quoted(e['quote'],citations.get(source_key,[])):endpoints[key]=None;continue
        value=e.get('value');unit=e.get('unit')
        if isinstance(value,bool) or not isinstance(value,(int,float,str)) or (isinstance(value,str) and not value.strip()): endpoints[key]=None;continue
        expected='text' if key=='burden' else '%' if key.startswith('os_') or key in ('orr','toxicity_grade3','discontinuation_toxicity') else 'months'
        if unit!=expected: endpoints[key]=None;continue
        if expected=='%' and not isinstance(value,(int,float)):endpoints[key]=None;continue
        if expected=='months' and isinstance(value,str) and value.lower() not in ('not reached','nedosažen','nedosaženo','nr'):endpoints[key]=None;continue
        if isinstance(value,(int,float)) and (value<0 or value!=value or value==float('inf') or (expected=='%' and value>100)): endpoints[key]=None;continue
        if isinstance(value,(int,float)):
            numbers=re.findall(r'(?<![\w])\d+(?:[.,]\d+)?(?![\w])',e['quote'])
            if not any(abs(float(n.replace(',','.'))-value)<1e-9 for n in numbers):endpoints[key]=None;continue
        if key.startswith('os_') and not raw.get('time_origin'): endpoints[key]=None;continue
        endpoints[key]={'value':value if isinstance(value,(int,float)) else value[:1500],'unit':unit,'ci':str(e['ci'])[:300] if e.get('ci') else None,'quote':e['quote'][:1500],'source_url':e['source_url'],'verification':'model_extracted_unverified','found_by':[model],'quote_matched_search_excerpt':citations is not None}
    # A model's match claims need exact supplied fact evidence; no evidence -> unknown.
    dimensions=[]; numerator=0;known=0;critical=[]
    fact_text=[f['text'] for f in profile['facts']]
    for key,weight in WEIGHTS.items():
        c=(raw.get('matching') or {}).get(key,{})
        if not isinstance(c,dict): c={}
        status=c.get('status');pq=c.get('patient_quote');sq=c.get('study_quote')
        if key=='performance_status':
            candidates=[fact for fact in profile['facts'] if re.search(r'\b(?:ECOG|KPS|Karnofsky)\b',fact['text'],re.I)]
            if candidates:
                latest=max(date_end(fact['date']) for fact in candidates)
                current=[fact['text'] for fact in candidates if date_end(fact['date'])==latest]
                if not isinstance(pq,str) or not any(pq in text for text in current):status='unknown'
        if citations is not None and not quoted(sq,citations.get(source_key,[])):status='unknown'
        if status not in ('match','mismatch') or not isinstance(pq,str) or len(pq)<8 or not any(pq in t for t in fact_text) or not isinstance(sq,str) or len(sq)<8:status='unknown'
        if status!='unknown':
            known+=weight
            if status=='match':numerator+=weight
            elif key in ('histology','biomarkers','treatment_line'):critical.append(key)
        dimensions.append({'key':key,'weight':weight,'status':status,'patient_quote':pq[:500] if isinstance(pq,str) else None,'study_quote':sq[:500] if isinstance(sq,str) else None,'explanation':str(c.get('explanation',''))[:600]})
    return {'cohort_id':raw.get('cohort_id') if isinstance(raw.get('cohort_id'),str) else None,'arm_id':raw.get('arm_id') if isinstance(raw.get('arm_id'),str) else None,'analysis_id':raw.get('analysis_id') if isinstance(raw.get('analysis_id'),str) else None,'study_title':title[:500],'arm':arm[:700],'population':population[:1500],'sample_size':raw.get('sample_size') if type(raw.get('sample_size')) is int and raw['sample_size']>0 else None,'source':{'url':source['url'],'doi':str(source['doi'])[:200] if source.get('doi') else None,'pmid':str(source['pmid'])[:40] if source.get('pmid') else None,'year':year,'published_date':published},'time_origin':str(raw['time_origin'])[:600] if raw.get('time_origin') else None,'endpoints':endpoints,'found_by':[model],'similarity':{'found_by':[model],'score':round(numerator/known*100) if known else None,'coverage':known,'dimensions':dimensions,'critical_mismatches':critical,'method':'Heuristická shoda mezi známými údaji; není pravděpodobnost přežití. Porovnání provedl model, výpočet server.'},'verification':'model_extracted_unverified','conflicts':[]}


def deduplicate(rows):
    merged={}
    for row in rows:
        source=row['source']
        doi=str(source.get('doi') or '').strip().lower()
        doi=re.sub(r'^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)','',doi).rstrip('/')
        pmid=str(source.get('pmid') or '').strip().lower()
        pmid=re.sub(r'^(?:https?://pubmed\.ncbi\.nlm\.nih\.gov/|pmid:\s*)','',pmid).rstrip('/')
        url=source['url'];url_doi=re.search(r'doi\.org/(10\.[^?#]+)',url,re.I);url_pmid=re.search(r'pubmed\.ncbi\.nlm\.nih\.gov/(\d+)',url,re.I)
        identity='doi:'+(doi or url_doi.group(1).lower().rstrip('/')) if doi or url_doi else 'pmid:'+(pmid or url_pmid.group(1)) if pmid or url_pmid else url_key(url)
        stable=[row.get(x) for x in ('cohort_id','arm_id','analysis_id')]
        dimensions=tuple(x.strip().casefold() for x in stable) if all(isinstance(x,str) and x.strip() for x in stable) else (row['arm'].strip().casefold(),row['population'].strip().casefold(),row['time_origin'])
        key=(identity,dimensions,row['time_origin'])
        if key not in merged: merged[key]=copy.deepcopy(row);continue
        existing=merged[key];existing['found_by']=sorted(set(existing['found_by']+row['found_by']))
        for field in ENDPOINTS:
            old,new=existing['endpoints'][field],row['endpoints'][field]
            prior_conflict=next((c for c in existing['conflicts'] if c['field']==field),None)
            if prior_conflict:
                if new is not None:prior_conflict['values'].append(new)
                continue
            if old is None:existing['endpoints'][field]=new
            elif new is not None and (old['value'],old['unit'],old['ci'])!=(new['value'],new['unit'],new['ci']):
                existing['conflicts'].append({'field':field,'values':[old,new],'found_by':sorted(set(old.get('found_by',[])+row['found_by']))})
                existing['endpoints'][field]=None
            elif new is not None:
                old['found_by']=sorted(set(old.get('found_by',[])+new.get('found_by',[])))
        def semantic(similarity):
            return (similarity['score'],similarity['coverage'],tuple((x['key'],x['status']) for x in similarity['dimensions']),tuple(similarity['critical_mismatches']))
        if semantic(existing['similarity'])!=semantic(row['similarity']):
            existing['similarity_variants']=existing.get('similarity_variants',[existing['similarity']])+[row['similarity']]
            existing['similarity']={'score':None,'coverage':0,'dimensions':[],'critical_mismatches':sorted(set(existing['similarity']['critical_mismatches']+row['similarity']['critical_mismatches'])),'method':'Modely se liší v posouzení podobnosti; ověřte podklady.'}
        else:
            existing['similarity']['found_by']=sorted(set(existing['similarity'].get('found_by',[])+row['similarity'].get('found_by',[])))
    return list(merged.values())


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise Problem('redirect','Neočekávané přesměrování služby.',502)


def remote_json(url, payload=None, key=None):
    headers={'Content-Type':'application/json','User-Agent':'CodeBridge-Prognosis/1.0'}
    if key: headers['Authorization']='Bearer '+key
    request=urllib.request.Request(url,data=json.dumps(payload).encode() if payload is not None else None,headers=headers)
    try:
        deadline=time.monotonic()+(240 if payload else 30)
        with urllib.request.build_opener(NoRedirect).open(request,timeout=150 if payload else 25) as response:
            chunks=[];size=0
            while True:
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError()
                # HTTPResponse wraps a socket in BufferedReader; constrain each
                # read to the remaining total budget, including slow streams.
                sock=getattr(getattr(getattr(response,'fp',None),'raw',None),'_sock',None)
                if sock is not None:sock.settimeout(remaining)
                chunk=response.read1(min(65536,MAX_RESPONSE+1-size))
                if time.monotonic()>deadline:raise TimeoutError()
                if not chunk:break
                chunks.append(chunk);size+=len(chunk)
                if size>MAX_RESPONSE:raise Problem('response_too_large','Odpověď překročila povolenou velikost.',502)
            content=b''.join(chunks)
        return json.loads(content)
    except urllib.error.HTTPError as e: raise Problem('provider_http','OpenRouter vrátil HTTP '+str(e.code)+'. Bez automatického opakování.',502)
    except (urllib.error.URLError,TimeoutError,OSError): raise Problem('provider_network','OpenRouter není dostupný nebo vypršel časový limit.',502)
    except (ValueError,UnicodeError): raise Problem('provider_json','OpenRouter vrátil neplatnou odpověď.',502)


def recover_complete_rows(text):
    '''Recover complete rows only from a truncated root JSON rows array.'''
    decoder=json.JSONDecoder();pos=0
    def whitespace(index):
        while index<len(text) and text[index].isspace():index+=1
        return index
    pos=whitespace(pos)
    if pos>=len(text) or text[pos]!='{':raise ValueError('invalid_root')
    pos+=1
    while True:
        pos=whitespace(pos)
        key,pos=decoder.raw_decode(text,pos)
        if not isinstance(key,str):raise ValueError('invalid_key')
        pos=whitespace(pos)
        if pos>=len(text) or text[pos]!=':':raise ValueError('invalid_header')
        pos=whitespace(pos+1)
        if key=='rows':break
        _,pos=decoder.raw_decode(text,pos)
        pos=whitespace(pos)
        if pos>=len(text) or text[pos]!=',':raise ValueError('no_rows_array')
        pos+=1
    if pos>=len(text) or text[pos]!='[':raise ValueError('invalid_rows')
    pos+=1;rows=[];after_comma=False
    while True:
        pos=whitespace(pos)
        if pos==len(text):return rows
        if text[pos]==']':
            if after_comma and rows:raise ValueError('trailing_comma')
            if text[pos+1:].strip() not in ('','}'):raise ValueError('invalid_array_suffix')
            return rows
        if text[pos]!='{':raise ValueError('invalid_row_prefix')
        try:row,end=decoder.raw_decode(text,pos)
        except json.JSONDecodeError as error:
            # Only a genuine unfinished JSON suffix is recoverable. Invalid
            # tokens, escapes and intervening junk reject the whole recovery.
            if error.pos>=len(text) or error.msg.startswith('Unterminated string'):return rows
            raise ValueError('malformed_row_suffix')
        if not isinstance(row,dict):raise ValueError('invalid_row_type')
        rows.append(row);after_comma=False
        if len(rows)>40:raise ValueError('too_many_rows')
        pos=whitespace(end)
        if pos==len(text):return rows
        if text[pos]==']':
            if text[pos+1:].strip() not in ('','}'):raise ValueError('invalid_array_suffix')
            return rows
        if text[pos]!=',':raise ValueError('invalid_row_separator')
        pos+=1;after_comma=True


def check_provider_error(response):
    if not isinstance(response,dict) or not response.get('error'):return
    error=response['error']
    code=error.get('code') if isinstance(error,dict) else None
    message=str(error.get('message','')).lower() if isinstance(error,dict) else ''
    # Provider messages may echo input. Return only an allowlisted category,
    # never arbitrary upstream prose or metadata.
    category='Služba vrátila chybu v odpovědi.'
    for tokens,description in [
        (('credit','balance','insufficient funds'),'Nedostatečný kredit nebo omezení účtování.'),
        (('unauthorized','authentication','invalid api key'),'Služba odmítla ověření klíče.'),
        (('rate limit','too many requests'),'Služba omezila počet požadavků.'),
        (('data collection','privacy','no endpoints'),'Není dostupný poskytovatel odpovídající nastavení soukromí.'),
        (('unsupported','not supported','tool'),'Služba odmítla nástroj nebo parametr požadavku.'),
        (('context','maximum tokens'),'Požadavek překročil limit kontextu nebo tokenů.')]:
        if any(token in message for token in tokens):category=description;break
    label=str(code) if type(code) is int and 100<=code<=599 else 'neznámý kód'
    raise Problem('provider_error','OpenRouter ('+label+'): '+category,502)


class Service:
    def __init__(self, transport=remote_json):
        self.transport=transport;self.lock=threading.Lock();self.cache={};self.catalog=None;self.catalog_at=0
    def config(self):
        return {'configured':bool(os.getenv('OPENROUTER_API_KEY')) and all(os.getenv(k) for k,_ in MODEL_ENV),'available':bool(os.getenv('OPENROUTER_API_KEY')),'models':[{'id':os.getenv(key,''),'label':label} for key,label in MODEL_ENV],'synthetic_only':True,'max_model_calls':1,'cache':'memory_only','model_configuration_complete':all(os.getenv(k) for k,_ in MODEL_ENV)}
    def resolve_models(self):
        configured=self.config()['models']
        if not all(x['id'] for x in configured): raise Problem('models_not_configured','Doplňte přesné ID modelu GPT Astra do serverového .env.',503)
        if not self.catalog or time.monotonic()-self.catalog_at>3600:
            catalog=self.transport('https://openrouter.ai/api/v1/models')
            self.catalog={x['id']:x for x in catalog['data']};self.catalog_at=time.monotonic()
        for m in configured:
            if m['id'] not in self.catalog:raise Problem('model_unavailable','Nakonfigurovaný model není v katalogu OpenRouter: '+m['id'],503)
            m['catalog_name']=self.catalog[m['id']].get('name',m['id'])
        return configured
    def run(self,request):
        if not isinstance(request,dict) or set(request)-{'patient_id','scheduled_date','refresh'}: raise Problem('invalid_request','Požadavek obsahuje nepodporovaná pole.')
        if type(request.get('refresh',False)) is not bool:raise Problem('invalid_request','Neplatná volba obnovení.')
        profile=profile_for(request.get('patient_id'),request.get('scheduled_date'))
        profile['evidence_cutoff']=min(dt.date.today(),dt.date.fromisoformat(profile['scheduled_date'])).isoformat()
        if not self.lock.acquire(False):raise Problem('busy','Již probíhá hledání. Vyčkejte na výsledek.',409)
        try:
            if not os.getenv('OPENROUTER_API_KEY'):raise Problem('missing_key','Na serveru chybí klíč OpenRouter.',503)
            models=self.resolve_models()
            effort=os.getenv('OPENROUTER_REASONING_EFFORT','')
            if effort and effort not in ('low','medium','high','xhigh','max','minimal'):raise Problem('invalid_reasoning_effort','Neplatná konfigurace reasoning effort.',503)
            effective_prompt=PROMPT
            cache_key=hashlib.sha256(json.dumps([profile,models,effective_prompt,effort],sort_keys=True,ensure_ascii=False).encode()).hexdigest()
            if cache_key in self.cache and not request.get('refresh'):
                result=copy.deepcopy(self.cache[cache_key]);result['cache_hit']=True;return result
            def call(model):
                payload={'model':model['id'],'messages':[{'role':'system','content':effective_prompt},{'role':'user','content':json.dumps(profile,ensure_ascii=False)}],'tools':[{'type':'openrouter:web_search','parameters':{'engine':'exa','max_uses':4,'max_results':5,'max_total_results':20}}],'max_tokens':14000,'max_tool_calls':4,'response_format':{'type':'json_object'},'provider':{'allow_fallbacks':False,'data_collection':'deny'}}
                supported=self.catalog[model['id']].get('supported_parameters',[])
                if 'temperature' in supported:payload['temperature']=0
                reasoning=self.catalog[model['id']].get('reasoning',{})
                if effort and 'reasoning' in supported and effort in (reasoning.get('supported_efforts') or []):payload['reasoning']={'effort':effort,'exclude':True}
                finish_reason=None;output_chars=0
                try:
                    response=self.transport('https://openrouter.ai/api/v1/chat/completions',payload,os.environ['OPENROUTER_API_KEY'])
                    check_provider_error(response)
                    usage=response.get('usage',{})
                    search_usage=usage.get('server_tool_use_details') or usage.get('server_tool_use') or {}
                    searches=search_usage.get('web_search_requests')
                    if isinstance(searches,bool) or not isinstance(searches,(int,float)) or not searches>=1:raise Problem('ungrounded_response','Model nepotvrdil provedení webového hledání; výsledky jsou skryty.',502)
                    choice=response['choices'][0];finish_reason=choice.get('finish_reason')
                    finish_reason=finish_reason if finish_reason in ('stop','length','tool_calls','content_filter','error') else 'unknown'
                    message=choice['message'];content=message['content']
                    citations=excerpt_citations(message)
                    if not isinstance(content,str):raise ValueError()
                    output_chars=len(content)
                    content=re.sub(r'^```(?:json)?\s*|\s*```$','',content.strip())
                    truncated=False
                    try:parsed=json.loads(content)
                    except json.JSONDecodeError:
                        if finish_reason!='length':raise
                        parsed={'rows':recover_complete_rows(content)};truncated=True
                        if not parsed['rows']:raise ValueError('no_complete_rows')
                    if not isinstance(parsed,dict) or not isinstance(parsed.get('rows'),list) or len(parsed['rows'])>40:raise ValueError()
                    rows=[normalize_row(row,model['id'],profile,citations) for row in parsed['rows']];rows=[r for r in rows if r]
                    limitations=parsed.get('limitations',[])
                    warnings=[x[:700] for x in limitations[:8] if isinstance(x,str)] if isinstance(limitations,list) else []
                    if truncated:warnings.append('Odpověď dosáhla limitu výstupu. Zobrazeny jsou pouze celé dokončené řádky; zbytek byl vynechán.')
                    if not citations:warnings.append('Služba neposkytla zdrojové úryvky. Nepodložené řádky a hodnoty byly skryty.')
                    if len(rows)<len(parsed['rows']):warnings.append('Některé řádky nemají dohledaný zdroj nebo datum publikace před MDT a byly skryty.')
                    return dict(model,status='partial' if truncated else 'success',error=None,error_code=None,finish_reason=finish_reason,output_chars=output_chars,parse_error=None,row_count=len(rows),web_search_requests=searches,warnings=warnings),rows
                except Problem as e:return dict(model,status='error',error=e.message,error_code=e.code,finish_reason=finish_reason,output_chars=output_chars,parse_error=None),[]
                except (KeyError,IndexError,ValueError,TypeError,AttributeError) as error:
                    category='invalid_json' if isinstance(error,json.JSONDecodeError) else 'invalid_schema'
                    return dict(model,status='error',error='Model nevrátil požadovaná strukturovaná data.',error_code='model_'+category,finish_reason=finish_reason,output_chars=output_chars,parse_error=category),[]
            results=[call(models[0])]
            result={'profile':profile,'models':[x[0] for x in results],'rows':deduplicate([r for x in results for r in x[1]]),'searched_at':dt.datetime.now(dt.timezone.utc).isoformat(),'scheduled_date':profile['scheduled_date'],'cache_hit':False,'warnings':profile['warnings']+['Výběr studií není vyčerpávající. Výsledky extrahoval model; citace a čísla vyžadují kontrolu v originálu.','Statistiky skupin nejsou individuální prognózou. Chybějící hodnoty nebyly dopočítány.']}
            if len(self.cache)>=32:self.cache.pop(next(iter(self.cache)))
            if any(model['status'] in ('success','partial') for model in result['models']):self.cache[cache_key]=copy.deepcopy(result)
            return result
        finally:self.lock.release()
