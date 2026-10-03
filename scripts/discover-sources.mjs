import fs from 'node:fs';
const UA='ARTSCAN-RD/3.0 source-discovery';
const timeout=8000;
async function get(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{headers:{'user-agent':UA},redirect:'follow',signal:c.signal});return r.ok?await r.text():''}catch{return''}finally{clearTimeout(t)}}
function origins(html,base){const out=[];for(const m of html.matchAll(/href=["']([^"'#]+)["']/gi)){try{const u=new URL(m[1],base);if(/^https?:$/.test(u.protocol))out.push(u.origin)}catch{}}return [...new Set(out)]}
const dirs=[
 ['DOE','https://www.energy.gov/national-laboratories','United States','North America'],
 ['Canada','https://www.canada.ca/en/services/science/institutes.html','Canada','North America'],
 ['NST','https://www.nst.re.kr/eng/contents.do?key=153','South Korea','Asia'],
 ['CAS','https://english.cas.cn/research/institutes/','China','Asia'],
 ['AU','https://au.int/en/specialised-agencies-institutions','African Union','Africa']
];
const discovered=[];
for(const [name,url,country,continent] of dirs){const html=await get(url);for(const origin of origins(html,url)){const h=new URL(origin).hostname;if(h.includes(new URL(url).hostname)||/facebook|youtube|linkedin|twitter|instagram/.test(h))continue;discovered.push({organism:`Discovered via ${name}`,country,continent,root_url:origin,source_type:'discovered_candidate',official:false,public_access:true,free_access:true,certification_url:url,certification_date:new Date().toISOString().slice(0,10),active:false,exclusion_reason:'requires_manual_official_status_validation'})}}
fs.writeFileSync('data/discovered-candidates.json',JSON.stringify([...new Map(discovered.map(x=>[x.root_url,x])).values()],null,2)+'\n');
console.log(`Discovered ${discovered.length} candidates. Candidates are NOT activated automatically.`);
