"""Opt-in real B2 runner; never emits credentials or presigned URLs."""
import os,json,sys,subprocess,sqlite3,signal
from pathlib import Path
from urllib.parse import urlparse
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
root=Path(os.environ.get('NORNS_ROOT',Path(__file__).resolve().parents[1])).resolve()
if not os.environ.get('EVIDENCE_DIR'):
 raise SystemExit('Set EVIDENCE_DIR to a new disposable output directory')
evidence=Path(os.environ['EVIDENCE_DIR']).resolve()
values=os.environ
if not os.environ.get('B2_TEST_BUCKET'):
 raise SystemExit('Set B2_TEST_BUCKET to confirm a dedicated non-production test bucket')
names=['S3_ENDPOINT','S3_REGION','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY']
assert all(values.get(n) for n in names),'incomplete S3 env'
assert values['S3_BUCKET']==os.environ['B2_TEST_BUCKET'],'S3_BUCKET must match B2_TEST_BUCKET'
for required in ['PLAYWRIGHT_MODULE','CHROMIUM_PATH']:
 if not os.environ.get(required):raise SystemExit('Set '+required+' before running B2 acceptance')
if evidence.exists():raise SystemExit('EVIDENCE_DIR must not exist; use a new directory')
evidence.mkdir(parents=True,mode=0o700)
u=urlparse(values['S3_ENDPOINT']);assert u.scheme=='https' and u.hostname==f"s3.{values['S3_REGION']}.backblazeb2.com" and not u.query and not u.username,'endpoint/region mismatch'
s3=boto3.client('s3',endpoint_url=values['S3_ENDPOINT'],region_name=values['S3_REGION'],aws_access_key_id=values['S3_ACCESS_KEY_ID'],aws_secret_access_key=values['S3_SECRET_ACCESS_KEY'],config=Config(signature_version='s3v4',s3={'addressing_style':'path'},retries={'max_attempts':0},connect_timeout=20,read_timeout=60))
bucket=values['S3_BUCKET']; report={'bucket':bucket,'endpointRegionMatched':True,'inspection':{},'cleanup':[],'versionCaveat':'DeleteObject hides current versions; historical/staging replay versions require operator lifecycle. No ACL/CORS/lifecycle writes or version purge.'}
for operation in ['head_bucket','get_bucket_location','get_bucket_acl','get_bucket_cors','get_bucket_lifecycle_configuration','get_bucket_versioning']:
 try:
  r=getattr(s3,operation)(Bucket=bucket)
  # Keep metadata only; no account identifiers or grants owner ids.
  record={'status':r['ResponseMetadata']['HTTPStatusCode']}
  for k in ['LocationConstraint','CORSRules','Rules','Status']: 
   if k in r: record[k]=r[k]
  if operation=='get_bucket_acl':record['publicGrants']=[g['Permission'] for g in r.get('Grants',[]) if g['Grantee'].get('URI','').endswith(('/AllUsers','/AuthenticatedUsers'))]
  report['inspection'][operation]=record
 except ClientError as e: report['inspection'][operation]={'status':e.response['ResponseMetadata']['HTTPStatusCode'],'code':e.response['Error']['Code']}
assert report['inspection']['get_bucket_location'].get('LocationConstraint')==values['S3_REGION'],'provider region mismatch'
assert not report['inspection']['get_bucket_acl'].get('publicGrants'),'public bucket denied'
env={**os.environ,**{n:values[n] for n in names}}
try:
 child=subprocess.Popen(['node','tests/b2-attachments-browser.mjs'],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
 try: child.communicate(timeout=180)
 except subprocess.TimeoutExpired:
  os.killpg(child.pid,signal.SIGTERM);child.communicate();report['runnerFailure']='runner timed out; owned process group terminated'
 report['runnerExitCode']=child.returncode
 # Intentionally do not persist raw stderr: browser diagnostics can include signed URLs.
 if (evidence/'browser-result.json').exists():report['acceptance']=json.loads((evidence/'browser-result.json').read_text())
 else:report['runnerFailure']='runner did not write structured result; raw diagnostics suppressed'
finally:
 db=evidence/'db.sqlite'
 if db.exists():
  conn=sqlite3.connect(db)
  for (key,) in conn.execute('SELECT staging FROM attachments UNION SELECT final_key FROM attachments'):
   assert key.startswith(('norns/staging/','norns/final/'))
   entry={'key':key}
   try:
    s3.delete_object(Bucket=bucket,Key=key)
    try:s3.head_object(Bucket=bucket,Key=key);entry['currentReadDenied']=False
    except ClientError as e:entry['headStatus']=e.response['ResponseMetadata']['HTTPStatusCode'];entry['currentReadDenied']=entry['headStatus']==404
   except ClientError as e:entry['cleanupFailure']=e.response['Error']['Code']
   report['cleanup'].append(entry)
  conn.close()
 report['passed']=bool(report.get('acceptance',{}).get('passed')) and all(x.get('currentReadDenied') for x in report['cleanup'])
 (evidence/'result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));os.chmod(evidence/'result.json',0o600)
 print(json.dumps({'passed':report['passed'],'result':str(evidence/'result.json')}))

sys.exit(0 if report['passed'] else 1)
