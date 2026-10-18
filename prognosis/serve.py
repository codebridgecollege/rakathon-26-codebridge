#!/usr/bin/env python3
"""Serve the local prognosis API on loopback (prognosis/README.md). Start from any directory."""
import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from prognosis.service import Problem, Service, load_env, profile_for

class Handler(BaseHTTPRequestHandler):
    server_version='CodeBridgeLocal/1.0'
    def log_message(self,*args):pass  # URLs may include case IDs. No request logs.
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        super().end_headers()
    def allowed(self):
        port=self.server.server_address[1]
        hosts={'127.0.0.1:'+str(port),'localhost:'+str(port)}
        if self.headers.get('Host') not in hosts:return False
        origin=self.headers.get('Origin')
        if origin and origin not in {'http://'+h for h in hosts}:return False
        if self.headers.get('Sec-Fetch-Site')=='cross-site':return False
        return self.client_address[0] in ('127.0.0.1','::1')
    def reply(self,status,data):
        body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def problem(self,e):self.reply(e.status,{'error':{'code':e.code,'message':e.message}})
    def do_GET(self):
        if not self.allowed():self.reply(403,{'error':{'code':'local_only','message':'Přístup je povolen pouze z lokální aplikace.'}});return
        parsed=urlsplit(self.path)
        if parsed.path=='/api/prognosis/config':self.reply(200,self.server.prognosis.config());return
        if parsed.path=='/api/prognosis/profile':
            try:
                q=parse_qs(parsed.query,strict_parsing=True)
                if set(q)!={'patient_id','scheduled_date'} or any(len(v)!=1 for v in q.values()):raise ValueError()
                profile=profile_for(q['patient_id'][0],q['scheduled_date'][0])
                self.reply(200,{'profile':profile,'scheduled_date':q['scheduled_date'][0]})
            except Problem as e:self.problem(e)
            except ValueError:self.problem(Problem('invalid_request','Neplatný požadavek profilu.'))
            return
        # The API only: no files are served.
        self.send_error(404)
    def do_HEAD(self):
        self.send_error(405)
    def do_POST(self):
        if not self.allowed():self.reply(403,{'error':{'code':'local_only','message':'Přístup je povolen pouze z lokální aplikace.'}});return
        if urlsplit(self.path).path!='/api/prognosis':self.send_error(404);return
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':self.problem(Problem('content_type','Použijte application/json.',415));return
        try:
            if self.headers.get('Transfer-Encoding'):raise ValueError()
            length=int(self.headers.get('Content-Length','0'))
            if length<=0 or length>2048:raise ValueError()
            request=json.loads(self.rfile.read(length))
            self.reply(200,self.server.prognosis.run(request))
        except Problem as e:self.problem(e)
        except (ValueError,UnicodeError):self.problem(Problem('invalid_request','Neplatný nebo příliš velký požadavek.'))
        except Exception:self.problem(Problem('internal_error','Hledání se nepodařilo dokončit.',500))

def make_server(port=8766,service=None):
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler);server.prognosis=service or Service();return server

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8766);args=parser.parse_args()
    load_env()
    server=make_server(args.port)
    print('CodeBridge prognosis API: http://127.0.0.1:'+str(server.server_address[1])+'/api/prognosis/config',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:server.server_close()
