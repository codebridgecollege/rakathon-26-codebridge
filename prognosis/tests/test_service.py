import copy
import importlib.util
import json
import os
import threading
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
from pathlib import Path
from prognosis.service import Service,Problem,date_end,profile_for,normalize_row,deduplicate,safe_url,excerpt_citations,recover_complete_rows

spec=importlib.util.spec_from_file_location('serve',Path(__file__).resolve().parents[2]/'prognosis'/'serve.py')
serve=importlib.util.module_from_spec(spec);spec.loader.exec_module(serve)
ENV={'OPENROUTER_API_KEY':'test-secret','OPENROUTER_MODEL_ASTRA':'a'}

def row(value=80):
 return {'study_title':'Controlled synthetic fixture, not medical evidence','arm':'Arm A','population':'Cohort X','source':{'url':'https://pubmed.ncbi.nlm.nih.gov/12345678/','pmid':'12345678','year':2020},'time_origin':'Randomization','endpoints':{'os_12':{'value':value,'unit':'%','quote':'Twelve month overall survival was '+str(value)+'% in Arm A.','source_url':'https://pubmed.ncbi.nlm.nih.gov/12345678/'}},'matching':{}}

class Tests(unittest.TestCase):
 def test_partial_dates(self):
  self.assertEqual(str(date_end('9/23')),'2023-09-30');self.assertEqual(str(date_end('2026-02')),'2026-02-28');self.assertEqual(str(date_end('11/2023 až 6/2025')),'2025-06-30');self.assertIsNone(date_end('31.2.2026'))
 def test_profile_cutoff_no_identifiers(self):
  p=profile_for('10_pacient.pdf','2023-04-01');s=json.dumps(p,ensure_ascii=False)
  self.assertNotIn('Daniel',s);self.assertNotIn('Poláček',s);self.assertNotIn('2025',s);self.assertNotIn('everolimus',s.lower());self.assertGreater(p['excluded_undated'],0)
  self.assertFalse(any('do 29.12.2025' in x['text'] for x in p['facts']))
  before=profile_for('10_pacient.pdf','2023-09-15');self.assertFalse(any(x['date']=='9/23' for x in before['facts']))
 def test_source_quote_future_cutoff(self):
  original=json.loads((Path(__file__).resolve().parents[2]/'fixtures/data/mock-case-10.json').read_text())
  original['timeline']=[{'date':'1.1.2023','label_cs':'Historical treatment','source':{'page':1,'quote':'Started 1.1.2023; progression 3.9.2026'}}]
  original['sections']={}
  real_load=json.loads
  def fixture(text,*args,**kwargs):
   loaded=real_load(text,*args,**kwargs)
   return original if isinstance(loaded,dict) and loaded.get('file')=='10_pacient.pdf' and 'timeline' in loaded else loaded
  with patch('prognosis.service.json.loads',side_effect=fixture):
   with self.assertRaises(Problem) as cm:profile_for('10_pacient.pdf','2023-04-01')
  self.assertEqual(cm.exception.code,'empty_profile')
 def test_s01_cutoff(self):
  with self.assertRaises(Problem):profile_for('S01_pacient.pdf','2025-12-31')
  p=profile_for('S01_pacient.pdf','2026-01-08');s=json.dumps(p,ensure_ascii=False)
  self.assertNotIn('Křemínek',s);self.assertNotIn('Modřínová',s);self.assertNotIn('progrese dle RANO',s)
 def test_s01_dated_clinical_state_and_medication(self):
  early=profile_for('S01_pacient.pdf','2026-01-09');late=profile_for('S01_pacient.pdf','2026-10-07')
  earlytext=' '.join(x['text'] for x in early['facts']);latetext=' '.join(x['text'] for x in late['facts'])
  self.assertIn('ECOG 1',earlytext);self.assertIn('KPS 80',earlytext);self.assertNotIn('ECOG 2',earlytext)
  self.assertIn('ECOG 2',latetext);self.assertIn('KPS 70',latetext);self.assertIn('Enoxaparin 80',latetext);self.assertIn('Dexamethason 4 mg',latetext)
  self.assertNotIn('Křemínek',latetext);self.assertNotIn('12.3.1964',latetext);self.assertNotIn('Modřínová',latetext)
 def test_latest_performance_status_for_similarity(self):
  p=profile_for('S01_pacient.pdf','2026-10-07');p['evidence_cutoff']='2026-10-07'
  r=row();r['matching']={'performance_status':{'status':'match','patient_quote':'KPS 80 %, ECOG 1','study_quote':'Study ECOG 0-1'}}
  result=normalize_row(r,'a',p)
  self.assertEqual(next(x for x in result['similarity']['dimensions'] if x['key']=='performance_status')['status'],'unknown')
 def test_inputs(self):
  for patient in ['../../.env','2_pacient.pdf',None]:
   with self.assertRaises(Problem):profile_for(patient,'2026-10-17')
  with self.assertRaises(Problem):profile_for('10_pacient.pdf','2026-02-30')
 def test_evidence_and_similarity(self):
  p=profile_for('10_pacient.pdf','2026-10-17');p['evidence_cutoff']='2026-10-17'
  a=normalize_row(row(),'a',p);self.assertIsNone(a['similarity']['score']);self.assertEqual(a['similarity']['coverage'],0)
  bad=row();bad['endpoints']['os_12']['quote']='';self.assertIsNone(normalize_row(bad,'a',p)['endpoints']['os_12'])
  bad=row();bad['time_origin']=None;self.assertIsNone(normalize_row(bad,'a',p)['endpoints']['os_12'])
  bad=row();bad['matching']={'histology':{'status':'match','patient_quote':'invented diagnosis','study_quote':'histology matches'}};self.assertIsNone(normalize_row(bad,'a',p)['similarity']['score'])
  bad=row();bad['source']['year']=2027;self.assertIsNone(normalize_row(bad,'a',p))
  a=normalize_row(row(),'a',p);b=normalize_row(row(85),'b',p);c=normalize_row(row(80),'c',p)
  merged=deduplicate([a,b,c]);self.assertEqual(len(merged),1);self.assertEqual(merged[0]['found_by'],['a','b','c']);self.assertIsNone(merged[0]['endpoints']['os_12']);self.assertEqual(len(merged[0]['conflicts']),1)
  b['arm']='Arm B';self.assertEqual(len(deduplicate([a,b])),2)
 def test_search_grounding_and_quote(self):
  p=profile_for('10_pacient.pdf','2026-10-17');p['evidence_cutoff']='2026-10-17'
  r=row();key='pubmed.ncbi.nlm.nih.gov/12345678'
  self.assertIsNone(normalize_row(r,'a',p,{}))
  self.assertIsNone(normalize_row(r,'a',p,{key:['Different excerpt']} )['endpoints']['os_12'])
  self.assertIsNotNone(normalize_row(r,'a',p,{key:[r['endpoints']['os_12']['quote']]})['endpoints']['os_12'])
  r['endpoints']['os_12']['source_url']='https://example.org/later'
  self.assertIsNone(normalize_row(r,'a',p,{key:['Different excerpt']})['endpoints']['os_12'])
  self.assertIsNone(normalize_row(dict(r,source=dict(r['source'],url='https://journal.example/article?id=2')),'a',p,{'journal.example/article?id=1':['Different excerpt']}))
  self.assertEqual(excerpt_citations({'annotations':[None,{'type':'url_citation','url_citation':{'url':row()['source']['url'],'content':'One [...] Two'}}]})[key],['One','Two'])
 def test_canonical_dedup(self):
  p=profile_for('10_pacient.pdf','2026-10-17');p['evidence_cutoff']='2026-10-17'
  a=normalize_row(row(),'a',p);b=copy.deepcopy(a);a['source']['doi']='https://doi.org/10.1234/ABC';b['source']['doi']='doi:10.1234/abc'
  self.assertEqual(len(deduplicate([a,b])),1)
  a['similarity']['dimensions'][0]['explanation']='Different phrasing'
  self.assertNotIn('similarity_variants',deduplicate([a,b])[0])
 def test_stable_cohorts_keep_distinct_time_origins(self):
  p=profile_for('10_pacient.pdf','2026-10-17');p['evidence_cutoff']='2026-10-17'
  a=normalize_row(row(),'a',p);b=copy.deepcopy(a)
  for item in (a,b):item.update(cohort_id='Cohort A',arm_id='Arm A',analysis_id='Primary analysis')
  b['time_origin']='Diagnosis';b['endpoints']['os_6']=copy.deepcopy(b['endpoints']['os_12']);b['endpoints']['os_12']=None
  self.assertEqual(len(deduplicate([a,b])),2)
 def test_provider_error_precedes_search_guard_without_echoing_input(self):
  def transport(url,payload=None,key=None):
   if payload is None:return {'data':[{'id':k} for k in 'abc']}
   return {'error':{'code':402,'message':'Insufficient credits. Sensitive echo: fictional patient XYZ diagnosis.'}}
  with patch.dict(os.environ,ENV):
   result=Service(transport).run({'patient_id':'10_pacient.pdf','scheduled_date':'2026-10-17'})
  self.assertIn('402',result['models'][0]['error']);self.assertNotIn('XYZ',json.dumps(result));self.assertNotIn('Sensitive echo',json.dumps(result))
 def test_current_and_legacy_search_usage(self):
  for usage_key in ['server_tool_use_details','server_tool_use']:
   def transport(url,payload=None,key=None):
    if payload is None:return {'data':[{'id':k} for k in 'abc']}
    return {'usage':{usage_key:{'web_search_requests':1}},'choices':[{'message':{'content':json.dumps({'rows':[]})}}]}
   with patch.dict(os.environ,ENV):
    result=Service(transport).run({'patient_id':'10_pacient.pdf','scheduled_date':'2026-10-17'})
   self.assertTrue(all(x['status']=='success' for x in result['models']))
 def test_all_failed_not_cached(self):
  calls=[]
  def transport(url,payload=None,key=None):
   if payload is None:return {'data':[{'id':k} for k in 'abc']}
   calls.append(payload);return {'error':{'code':429,'message':'Rate limit'}}
  with patch.dict(os.environ,ENV):
   service=Service(transport);request={'patient_id':'10_pacient.pdf','scheduled_date':'2026-10-17'}
   self.assertFalse(service.run(request)['cache_hit']);self.assertFalse(service.run(request)['cache_hit'])
  self.assertEqual(len(calls),2)
 def test_truncated_rows_recover_only_complete_objects(self):
  prefix='{"rows":['+json.dumps(row())+','+json.dumps(row(85))+','
  self.assertEqual(len(recover_complete_rows(prefix+'{"study_title":"unfinished')),2)
  self.assertEqual(len(recover_complete_rows(prefix)),2)
  for bad in [prefix+'EVIL',prefix+'{"value": not_json}',prefix+'{} EVIL',prefix+'] trailing garbage','pretend '+prefix]:
   with self.assertRaises(ValueError):recover_complete_rows(bad)
 def test_truncation_status_and_safe_diagnostics(self):
  content='{"rows":['+json.dumps(row())+','+json.dumps(row(85))+',{"study_title":"unfinished'
  def transport(url,payload=None,key=None):
   if payload is None:return {'data':[{'id':k} for k in 'abc']}
   return {'usage':{'server_tool_use_details':{'web_search_requests':1}},'choices':[{'finish_reason':'length','message':{'content':content,'annotations':[{'type':'url_citation','url_citation':{'url':row()['source']['url'],'content':row()['endpoints']['os_12']['quote']+' [...] '+row(85)['endpoints']['os_12']['quote']}}]}}]}
  with patch.dict(os.environ,ENV):
   result=Service(transport).run({'patient_id':'10_pacient.pdf','scheduled_date':'2026-10-17'})
  self.assertTrue(all(x['status']=='partial' for x in result['models']));self.assertEqual(result['models'][0]['finish_reason'],'length');self.assertEqual(result['models'][0]['output_chars'],len(content));self.assertGreater(len(result['rows']),0)
 def test_urls(self):
  for value in ['javascript:alert(1)','http://127.0.0.1/','https://127.0.0.1/','https://a:b@example.org','https://example.org:99/']:self.assertIsNone(safe_url(value))
 def test_one_call_and_cache(self):
  calls=[]
  def transport(url,payload=None,key=None):
   if payload is None:return {'data':[{'id':k} for k in 'abc']}
   calls.append(payload)
   if payload['model']=='b':raise Problem('down','Synthetic fixture failure',502)
   return {'usage':{'server_tool_use':{'web_search_requests':1}},'choices':[{'message':{'content':json.dumps({'rows':[row()]}),'annotations':[{'type':'url_citation','url_citation':{'url':row()['source']['url'],'content':row()['endpoints']['os_12']['quote']}}]}}]}
  with patch.dict(os.environ,ENV):
   service=Service(transport);request={'patient_id':'10_pacient.pdf','scheduled_date':'2026-10-17'}
   result=service.run(request);self.assertEqual(len(calls),1);self.assertEqual(len(result['models']),1);self.assertEqual(len(result['rows']),1)
   self.assertTrue(service.run(request)['cache_hit']);self.assertEqual(len(calls),1)
   self.assertNotIn('Daniel',json.dumps(calls));self.assertNotIn('Poláček',json.dumps(calls))
   self.assertEqual(calls[0]['tools'][0]['type'],'openrouter:web_search')
 def test_no_search_usage_rejected(self):
  def transport(url,payload=None,key=None):
   if payload is None:return {'data':[{'id':k} for k in 'abc']}
   return {'choices':[{'message':{'content':json.dumps({'rows':[row()]})}}]}
  with patch.dict(os.environ,ENV):
   result=Service(transport).run({'patient_id':'10_pacient.pdf','scheduled_date':'2026-10-17'})
  self.assertEqual(result['rows'],[]);self.assertTrue(all(x['status']=='error' for x in result['models']))
 def test_busy(self):
  service=Service();service.lock.acquire()
  with patch.dict(os.environ,ENV):
   with self.assertRaises(Problem) as cm:service.run({'patient_id':'10_pacient.pdf','scheduled_date':'2026-10-17'})
  self.assertEqual(cm.exception.status,409);service.lock.release()
 def test_malformed_model_json(self):
  def transport(url,payload=None,key=None):
   if payload is None:return {'data':[{'id':k} for k in 'abc']}
   return {'choices':[{'message':{'content':'not JSON'}}]}
  with patch.dict(os.environ,ENV):
   result=Service(transport).run({'patient_id':'10_pacient.pdf','scheduled_date':'2026-10-17'});self.assertEqual(result['rows'],[]);self.assertTrue(all(x['status']=='error' for x in result['models']))
 def test_http_security(self):
  server=serve.make_server(0,Service());thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  base='http://127.0.0.1:'+str(server.server_address[1])
  try:
   with urllib.request.urlopen(base+'/api/prognosis/config') as response:self.assertEqual(response.status,200);self.assertNotIn('test-secret',response.read().decode())
   for path in ['/../.env','/data/mock-case-10.json','/%2Fdata/mock-case-10.json','/']:
    with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(base+path)
   with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(urllib.request.Request(base+'/api/prognosis/config',headers={'Host':'evil.example'}))
   self.assertEqual(cm.exception.code,403)
   with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(urllib.request.Request(base+'/api/prognosis',data=b'{}',headers={'Content-Type':'application/json','Origin':'https://evil.example'}))
   self.assertEqual(cm.exception.code,403)
  finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
