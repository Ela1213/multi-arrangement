"""Check the formal 93-word API through the first full trial and adaptive next trial."""
import json,math,time,urllib.request
BASE='http://127.0.0.1:3500';PID='FORMALSMOKE'+str(int(time.time()))
def call(method,path,body=None,token=None):
 h={'content-type':'application/json'}
 if token:h['x-participant-invite']=token
 req=urllib.request.Request(BASE+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers=h)
 with urllib.request.urlopen(req,timeout=240) as r:return json.load(r)
config=call('GET','/api/config');assert len(config['words'])==93
invite=call('POST','/api/participant/start',{'participant_id':PID})['invite']
session=call('POST',f'/api/ma/public/invites/{invite}/start',token=invite)
sid=session['session_id']
first=call('GET',f'/api/ma/sessions/{sid}/next',token=invite)
assert len(first['subset_indices'])==93
positions={}
for k,idx in enumerate(first['subset_indices']):
 ring=k%5;slot=k//5;nr=math.ceil((93-ring)/5);angle=2*math.pi*(slot+ring*.21)/nr
 radius=55+ring*56
 positions[str(idx)]={'x':350+radius*math.cos(angle),'y':350+radius*math.sin(angle)}
start=time.monotonic()
result=call('POST',f'/api/ma/sessions/{sid}/trials',{'trial_index':0,'subset_indices':first['subset_indices'],'positions':positions,'arena_size':700,'duration_seconds':120},invite)
elapsed=round(time.monotonic()-start,2)
next_trial=result['next_trial']
assert not next_trial['is_final'] and 15<=len(next_trial['subset_indices'])<=25,next_trial
assert len(set(next_trial['subset_indices']))==len(next_trial['subset_indices'])
print(json.dumps({'first_words':93,'next_subset':len(next_trial['subset_indices']),'first_trial_save_and_subset_seconds':elapsed,'session_id':sid}))
