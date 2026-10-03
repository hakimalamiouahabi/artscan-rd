#!/usr/bin/env python3
import csv, io, json, os, re, ssl, time, urllib.request, urllib.error, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

ZIP_URL = "https://nces.ed.gov/ipeds/complete-data-files/HD2025.zip"
CERT_URL = ZIP_URL
UA = "ARTSCAN-RD/3.2 registry-certifier (+https://github.com/hakimalamiouahabi/artscan-rd)"
TIMEOUT = 7
MAX_WORKERS = 24

def download():
    req=urllib.request.Request(ZIP_URL,headers={"User-Agent":UA,"Accept":"application/zip,*/*;q=0.5"})
    with urllib.request.urlopen(req,timeout=30) as r:
        return r.read()

def normalize(raw):
    s=(raw or "").strip().strip('"').strip()
    if not s:
        return None
    # Keep the first URL/domain if an institution entered multiple values.
    parts=re.split(r"[\s;,]+",s)
    s=next((p for p in parts if "." in p),parts[0] if parts else "")
    if not re.match(r"^https?://",s,re.I):
        s="https://"+s
    try:
        u=urlparse(s)
        if not u.hostname:
            return None
        return s
    except Exception:
        return None

def try_url(url):
    candidates=[url]
    if url.startswith("https://"):
        candidates.append("http://"+url[len("https://"):])
    for candidate in candidates:
        req=urllib.request.Request(candidate,headers={"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2"})
        try:
            with urllib.request.urlopen(req,timeout=TIMEOUT) as r:
                status=getattr(r,"status",200)
                ctype=(r.headers.get("content-type") or "").lower()
                body=r.read(4096)
                if 200 <= status < 400 and body and ("text" in ctype or "html" in ctype or ctype==""):
                    return {"ok":True,"url":r.geturl(),"status":status}
        except urllib.error.HTTPError as e:
            # 403/401 are not certified as anonymously accessible.
            if 400 <= e.code < 500 and e.code not in (408,429):
                return {"ok":False,"url":candidate,"status":e.code}
        except Exception:
            pass
    return {"ok":False,"url":url,"status":None}

blob=download()
with zipfile.ZipFile(io.BytesIO(blob)) as z:
    csv_name=next((n for n in z.namelist() if n.lower().endswith(".csv") and "hd2025" in n.lower()),None)
    if not csv_name:
        raise SystemExit("HD2025 CSV not found in archive")
    with z.open(csv_name) as raw:
        text=io.TextIOWrapper(raw,encoding="utf-8-sig",errors="replace",newline="")
        reader=csv.DictReader(text)
        required={"UNITID","INSTNM","CONTROL","ICLEVEL","HLOFFER","WEBADDR"}
        missing=required-set(reader.fieldnames or [])
        if missing:
            raise SystemExit("Missing IPEDS columns: "+",".join(sorted(missing)))
        candidates=[]
        for row in reader:
            if row.get("CONTROL","").strip()!="1":
                continue
            if row.get("ICLEVEL","").strip()!="1":
                continue
            try:
                hlo=int(row.get("HLOFFER","") or -1)
            except ValueError:
                continue
            # Master's, post-master's, or doctoral highest level.
            if hlo not in (7,8,9):
                continue
            if row.get("CYACTIVE") not in (None,"","1"):
                continue
            u=normalize(row.get("WEBADDR"))
            if not u:
                continue
            candidates.append({
                "unitid":row.get("UNITID"),
                "organism":row.get("INSTNM","").strip(),
                "root_url":u
            })

seen={}
for x in candidates:
    try:
        host=urlparse(x["root_url"]).hostname.lower().removeprefix("www.")
    except Exception:
        continue
    if host and host not in seen:
        seen[host]=x
candidates=list(seen.values())

results=[]
with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
    futures={ex.submit(try_url,x["root_url"]):x for x in candidates}
    done=0
    for fut in as_completed(futures):
        x=futures[fut]
        done+=1
        try:
            acc=fut.result()
        except Exception:
            continue
        if not acc.get("ok"):
            continue
        results.append({
            "organism":x["organism"],
            "country":"United States",
            "continent":"North America",
            "root_url":acc["url"],
            "source_type":"public_graduate_higher_education_research_source",
            "official":True,
            "public_access":True,
            "free_access":True,
            "certification_url":CERT_URL,
            "certification_date":time.strftime("%Y-%m-%d",time.gmtime()),
            "certification_method":"NCES_IPEDS_CONTROL_PUBLIC_ICLEVEL4PLUS_HLOFFER_GRADUATE_plus_institution_reported_WEBADDR_plus_anonymous_http_access",
            "access_checked_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),
            "access_http_status":acc["status"],
            "language":"en",
            "category":"public_higher_education_research",
            "active":True,
            "external_id":"IPEDS:"+str(x["unitid"])
        })
        if done % 100 == 0:
            print("IPEDS_PROGRESS",done,"/",len(candidates),"certified",len(results),flush=True)

results.sort(key=lambda x:x["organism"].lower())
os.makedirs("data",exist_ok=True)
with open("data/registry-ipeds.json","w",encoding="utf-8") as f:
    json.dump(results,f,ensure_ascii=False,indent=2)
    f.write("\n")
stats={
    "source":"NCES IPEDS HD2025",
    "candidatesPublicFourYearGraduate":len(candidates),
    "certifiedAnonymousAccessible":len(results),
    "uniqueHosts":len({urlparse(x["root_url"]).hostname.lower().removeprefix("www.") for x in results})
}
with open("data/registry-ipeds-stats.json","w",encoding="utf-8") as f:
    json.dump(stats,f,ensure_ascii=False,indent=2)
    f.write("\n")
print(json.dumps(stats,indent=2))
