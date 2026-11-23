"""Check the real browser's 93-word first trial and save a screenshot."""
import base64,json,subprocess,sys,time,urllib.request
from pathlib import Path
import websocket
ROOT=Path(__file__).resolve().parent
BASE='http://127.0.0.1:3500'; pid='FORMALBROWSER'+str(int(time.time()))
chrome=subprocess.Popen(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--remote-allow-origins=*','--remote-debugging-port=9224','--user-data-dir=/private/tmp/chrome-formal-93','--window-size=1920,1080',BASE+'/?participant_id='+pid],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
ws=None
try:
 for _ in range(90):
  try:
   with urllib.request.urlopen('http://127.0.0.1:9224/json',timeout=.4) as r: pages=json.load(r)
   page=next(x for x in pages if x['type']=='page' and '127.0.0.1:3500' in x['url']);break
  except Exception:time.sleep(.1)
 else:raise RuntimeError('Chrome not ready')
 ws=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=10,origin='http://localhost'); seq=0
 def cmd(name,args=None):
  global seq
  seq+=1;id=seq;ws.send(json.dumps({'id':id,'method':name,'params':args or {}}))
  while True:
   obj=json.loads(ws.recv())
   if obj.get('id')==id:
    if obj.get('error'):raise RuntimeError(obj['error'])
    return obj.get('result',{})
 def js(code):return cmd('Runtime.evaluate',{'expression':code,'returnByValue':True,'awaitPromise':True})['result'].get('value')
 for _ in range(100):
  if js('document.getElementById("begin")?.disabled===false'):break
  time.sleep(.1)
 else:raise RuntimeError('Instructions not ready')
 shot=cmd('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
 (ROOT/'formal-instructions.png').write_bytes(base64.b64decode(shot['data']))
 js('document.getElementById("begin").click()')
 for _ in range(150):
  if js('document.querySelectorAll(".word-card").length')==93:break
  time.sleep(.1)
 else:raise RuntimeError('93 words not rendered')
 checks=js('''(() => {let cards=[...document.querySelectorAll('.word-card')], b=cards.map(x=>x.getBoundingClientRect());let collisions=0;for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++)if(b[i].left<b[j].right&&b[i].right>b[j].left&&b[i].top<b[j].bottom&&b[i].bottom>b[j].top)collisions++;return {count:cards.length,collisions,truncated:cards.filter(c=>c.scrollWidth>c.clientWidth+1).map(c=>c.title),doneDisabled:document.getElementById('submit').disabled,viewport:[innerWidth,innerHeight]}})()''')
 assert checks['count']==93 and checks['collisions']==0 and not checks['truncated'] and checks['doneDisabled'],checks
 shot=cmd('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
 (ROOT/'formal-first-round.png').write_bytes(base64.b64decode(shot['data']))
 if '--group' in sys.argv:
  area=js('''(() => {const w=document.getElementById('workspace').getBoundingClientRect();return {x:w.left,y:w.top,s:w.width/1920}})()''')
  def mouse(kind,x,y,buttons=0):cmd('Input.dispatchMouseEvent',{'type':kind,'x':x,'y':y,'button':'left','buttons':buttons,'clickCount':1})
  x=lambda n:area['x']+n*area['s'];y=lambda n:area['y']+n*area['s']
  before=js('''[...document.querySelectorAll('.word-card')].filter(c=>c.offsetTop===10&&c.offsetLeft<300).map(c=>({id:c.dataset.ordinal,x:c.offsetLeft,y:c.offsetTop}))''')
  mouse('mousePressed',x(2),y(2),1);mouse('mouseMoved',x(285),y(45),1);mouse('mouseReleased',x(285),y(45))
  selected=js('document.querySelectorAll(".word-card.selected").length')
  assert selected>=2,selected
  first=js('''(() => {let c=document.querySelector('.word-card.selected').getBoundingClientRect();return {x:c.left+c.width/2,y:c.top+c.height/2}})()''')
  mouse('mousePressed',first['x'],first['y'],1);mouse('mouseMoved',first['x']+40,first['y']+40,1);mouse('mouseReleased',first['x']+40,first['y']+40)
  after=js('''[...document.querySelectorAll('.word-card.selected')].map(c=>({id:c.dataset.ordinal,x:c.offsetLeft,y:c.offsetTop}))''')
  assert len(after)==selected and all(c['y']>10 for c in after),after
  checks['group_selected']=selected
  shot=cmd('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
  (ROOT/'formal-group-selection.png').write_bytes(base64.b64decode(shot['data']))

 if '--submit' in sys.argv:
  import math
  slots=[(x,y) for y in range(-270,271,30) for x in range(-270,271,92) if math.hypot(abs(x)+53,abs(y)+14)<=347][:93]
  assert len(slots)==93
  for i,(dx,dy) in enumerate(slots):
   points=js('''(() => {const c=document.querySelectorAll('.word-card')[%d].getBoundingClientRect(),a=document.getElementById('arena').getBoundingClientRect();return {sx:c.left+c.width/2,sy:c.top+c.height/2,tx:a.left+a.width/2+%d*a.width/700,ty:a.top+a.height/2+%d*a.width/700}})()'''%(i,dx,dy))
   cmd('Input.dispatchMouseEvent',{'type':'mouseMoved','x':points['sx'],'y':points['sy']})
   cmd('Input.dispatchMouseEvent',{'type':'mousePressed','x':points['sx'],'y':points['sy'],'button':'left','clickCount':1})
   cmd('Input.dispatchMouseEvent',{'type':'mouseMoved','x':points['tx'],'y':points['ty'],'button':'left','buttons':1})
   cmd('Input.dispatchMouseEvent',{'type':'mouseReleased','x':points['tx'],'y':points['ty'],'button':'left','clickCount':1})
  placed=js('document.getElementById("placement-status").textContent')
  assert placed=='93/93 inside',placed
  shot=cmd('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
  (ROOT/'formal-after-placement.png').write_bytes(base64.b64decode(shot['data']))
  done=js('''(() => {const r=document.getElementById('submit').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,disabled:document.getElementById('submit').disabled}})()''')
  assert not done['disabled']
  cmd('Input.dispatchMouseEvent',{'type':'mousePressed','x':done['x'],'y':done['y'],'button':'left','clickCount':1})
  cmd('Input.dispatchMouseEvent',{'type':'mouseReleased','x':done['x'],'y':done['y'],'button':'left','clickCount':1})
  for _ in range(100):
   n=js('document.querySelectorAll(".word-card").length')
   if 15<=n<=25:break
   time.sleep(.1)
  else:raise RuntimeError('Next subset did not render')
  checks['next_subset']=n
 print(json.dumps(checks))
finally:
 if ws:ws.close()
 chrome.terminate()
 try:chrome.wait(timeout=5)
 except subprocess.TimeoutExpired:chrome.kill()
