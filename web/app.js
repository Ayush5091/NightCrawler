const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const short = (value, n = 65) => String(value ?? '').length > n ? `${String(value).slice(0,n)}…` : String(value ?? '');
const bytes = (value) => value == null ? '—' : value < 1024 ? `${value} B` : value < 1048576 ? `${(value/1024).toFixed(1)} KB` : `${(value/1048576).toFixed(1)} MB`;
const table = (headers, rows) => rows.length ? `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty">No observations in this scan.</div>';
document.querySelector('#network').insertAdjacentHTML('beforebegin', '<section id="browser-state"><div class="section-title"><h3>Cookies & browser storage</h3><span>Names and attributes only</span></div><div class="grid-two"><article class="card table-card"><h4>Cookies</h4><div id="cookie-list"></div></article><article class="card table-card"><h4>Storage</h4><div id="storage-list"></div></article></div><article class="card"><h4>Consent observations</h4><div id="consent-list"></div></article></section>');
let selectedId = null;

async function history() {
  const scans = await fetch('/api/scans').then((r) => r.json());
  $('history-list').innerHTML = table(['Website','Status','Scanned','Pages','Compare'], scans.map((s) => [
    `<button class="link-button" data-open="${esc(s.id)}">${esc(s.url)}</button>`,
    s.status === 'failed' ? `<span class="pill warn" title="${esc(s.error||'Page failed')}">Failed</span>` : '<span class="pill">Complete</span>',
    esc(new Date(s.startedAt).toLocaleString()), esc(s.summary.pagesScanned),
    selectedId && selectedId !== 'demo' && selectedId !== s.id ? `<button class="link-button" data-compare="${esc(s.id)}">Compare</button>` : '—',
  ]));
}

function render(id, scan, insights) {
  selectedId = id;
  $('report').hidden = false;
  $('report-title').textContent = scan.demo ? `Demo report · ${scan.startUrl}` : scan.startUrl;
  $('report-meta').textContent = scan.demo ? 'Synthetic sample data for exploring the dashboard. No website was scanned.' : `${new Date(scan.startedAt).toLocaleString()} · ${scan.device||'desktop'} · ${scan.mode} · ${scan.consentUi.action ? scan.consentUi.action.succeeded ? `${scan.consentUi.action.choice} clicked` : 'consent button unavailable' : 'no consent action'} · ${scan.summary.limitReached ? `Stopped at ${scan.summary.limitReached}` : 'Crawl complete'}`;
  $('json-link').href = `/api/scans/${id}/json`;
  $('csv-link').href = `/api/scans/${id}/csv`;
  $('pdf-link').href = `/api/scans/${id}/pdf`;
  const metrics = [['Pages',scan.summary.pagesScanned],['Requests',scan.summary.requestsObserved],['Third parties',scan.summary.thirdPartyDomains],['Technologies',scan.summary.technologiesDetected],['Data fields',insights.dataFields.length]];
  $('metrics').innerHTML = metrics.map(([name,value]) => `<div class="metric"><strong>${esc(value)}</strong><span>${esc(name)}</span></div>`).join('');
  const audit = scan.lighthouse;
  const scoreNames = {'performance':'Performance','accessibility':'Accessibility','best-practices':'Best practices','seo':'SEO'};
  $('lighthouse-scores').innerHTML = audit?.status === 'completed' ? Object.entries(scoreNames).map(([id,name]) => {
    const score = audit.scores?.[id];
    const tone = score == null ? 'neutral' : score >= 90 ? 'good' : score >= 50 ? 'moderate' : 'poor';
    return `<div class="metric audit-score ${tone}"><strong>${esc(score == null ? '—' : score)}</strong><span>${esc(name)} · Lighthouse</span></div>`;
  }).join('') : `<div class="audit-unavailable">${esc(audit?.error ? `Lighthouse audit failed: ${audit.error}` : 'Lighthouse audit not available for this report.')}</div>`;
  const types = new Map(); for (const request of scan.requests) types.set(request.resourceType,(types.get(request.resourceType)||0)+1);
  const max = Math.max(1,...types.values());
  $('resource-bars').innerHTML = [...types].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,count]) => `<div class="bar-row"><span>${esc(name)}</span><div class="bar"><i style="width:${100*count/max}%"></i></div><span>${count}</span></div>`).join('') || '<div class="empty">No resource data</div>';
  const perf = scan.pages.find((p) => p.performance)?.performance;
  $('performance').innerHTML = [['DOMContentLoaded',perf?.domContentLoadedMs == null ? '—' : `${perf.domContentLoadedMs} ms`],['Load event',perf?.loadMs == null ? '—' : `${perf.loadMs} ms`],['First contentful paint',perf?.fcpMs == null ? '—' : `${perf.fcpMs} ms`],['Transferred resources',bytes(scan.requests.reduce((s,r)=>s+(r.transferBytes||0),0))]].map(([k,v]) => `<div class="stat-line"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
  if (audit?.status === 'completed') $('performance').innerHTML += [['LCP','largest-contentful-paint'],['CLS','cumulative-layout-shift'],['Total blocking time','total-blocking-time'],['Speed Index','speed-index']].map(([label,id])=>`<div class="stat-line"><span>${esc(label)}</span><strong>${esc(audit.metrics?.[id]?.displayValue||'—')}</strong></div>`).join('');
  const crux = scan.cruxHistory;
  if (crux?.status === 'available' && crux.periods.length) {
    const last = crux.periods.at(-1);
    $('performance').innerHTML += `<div class="stat-line"><span>Real-user LCP p75 (${esc(last.end)})</span><strong>${esc(last.lcpP75 == null ? '—' : `${(last.lcpP75/1000).toFixed(2)} s`)}</strong></div><div class="stat-line"><span>Real-user INP p75</span><strong>${esc(last.inpP75 == null ? '—' : `${last.inpP75} ms`)}</strong></div><div class="muted">CrUX ${esc(crux.formFactor)} · ${crux.periods.length} historical periods</div>`;
  } else $('performance').innerHTML += `<div class="muted">Real-user history: ${esc(crux?.status === 'not_configured' ? 'configure CRUX_API_KEY' : crux?.status === 'insufficient_data' ? 'insufficient CrUX data' : crux?.status === 'failed' ? crux.error : 'unavailable')}</div>`;
  $('audit-opportunities').innerHTML = audit?.status === 'completed' ? table(['Audit','Score','Potential saving'],(audit.opportunities||[]).map((item)=>[esc(item.title),esc(item.score == null ? '—' : Math.round(item.score*100)),esc(item.displayValue||'—')])) : '<div class="empty">No Lighthouse audit available.</div>';
  $('dns').innerHTML = Object.entries(scan.infrastructure?.dns||{}).filter(([,v])=>v.length).map(([k,v])=>`<div class="stat-line"><span>${esc(k)}</span><strong>${esc(short(v.join(', '),90))}</strong></div>`).join('') || '<div class="empty">DNS records unavailable</div>';
  const geo = scan.infrastructure?.geo;
  if (geo) $('dns').innerHTML += [['Server IP',geo.ip],['IP country',geo.country],['City',geo.city],['ASN',geo.asn == null ? null : `AS${geo.asn}`],['Network owner',geo.networkOwner]].map(([k,v])=>`<div class="stat-line"><span>${esc(k)}</span><strong>${esc(v ?? '—')}</strong></div>`).join('') + (geo.status === 'database_missing' ? '<div class="muted">Add local GeoLite2 City and ASN databases for location and network ownership.</div>' : '');
  const tls = scan.infrastructure?.tls;
  $('tls').innerHTML = tls ? [['Protocol',tls.protocol],['Subject',tls.subject],['Issuer',tls.issuer],['Expires',tls.validTo],['SANs',tls.subjectAltNames?.length]].map(([k,v])=>`<div class="stat-line"><span>${esc(k)}</span><strong>${esc(v||'—')}</strong></div>`).join('') : '<div class="empty">TLS certificate unavailable</div>';
  $('flow-list').innerHTML = insights.graph.slice(0,100).map((edge) => `<div class="flow"><strong>${esc(short(edge.source,40))}</strong> → ${esc(edge.destination)}<small>${edge.requests} requests${edge.categories.length ? ` · ${esc(edge.categories.join(', '))}` : ''}</small></div>`).join('') || '<div class="empty">No flows observed</div>';
  $('field-list').innerHTML = insights.dataFields.slice(0,100).map((field) => `<div class="field"><strong>${esc(field.field)}</strong> <span class="pill">${esc(field.category)}</span><small>${esc(field.destinations.join(', '))}</small></div>`).join('') || '<div class="empty">No field names observed</div>';
  $('unknown-list').innerHTML = insights.unknownDestinations.map((host) => `<span class="pill warn">${esc(host)}</span>`).join('') || '<div class="empty">No unknown third parties observed</div>';
  if (scan.subdomains?.length) $('unknown-list').innerHTML += `<div class="stat-line"><span>Discovered subdomains</span><strong>${esc(scan.subdomains.join(', '))}</strong></div>`;
  if (scan.websockets?.length) $('unknown-list').innerHTML += `<div class="stat-line"><span>WebSockets</span><strong>${esc(scan.websockets.length)}</strong></div>`;
  if (scan.serviceWorkers?.length) $('unknown-list').innerHTML += `<div class="stat-line"><span>Service workers</span><strong>${esc(scan.serviceWorkers.length)}</strong></div>`;
  $('cookie-list').innerHTML = table(['Name','Domain','Expiry','Protection','Phase'],(scan.cookies||[]).slice(0,300).map((c)=>[esc(c.name),`${esc(c.domain)}${c.isThirdParty?' <span class="pill warn">Third party</span>':''}<div class="muted">${esc(c.vendor||c.category||'')}</div>`,esc(c.expires||'Session'),`${c.secure?'Secure · ':''}${c.httpOnly?'HttpOnly · ':''}${esc(c.sameSite||'No SameSite')}`,esc(c.phase === 'after_consent_action' ? 'After action' : 'Before action')]));
  $('storage-list').innerHTML = table(['Kind','Key/database','Origin'],(scan.storage||[]).slice(0,300).map((s)=>[esc(s.kind.replaceAll('_',' ')),esc(s.name),esc(short(s.origin,55))]));
  $('consent-list').innerHTML = `<div class="stat-line"><span>Banner detected</span><strong>${scan.consentUi.detected?'Yes':'No'}</strong></div><div class="stat-line"><span>Action</span><strong>${esc(scan.consentUi.action ? `${scan.consentUi.action.choice}: ${scan.consentUi.action.succeeded?'clicked':'unavailable'}` : 'Baseline observation')}</strong></div>` + (scan.consentUi.signals||[]).map((s)=>`<div class="stat-line"><span>${esc(s.kind.replaceAll('_',' '))}</span><strong>${esc(short(s.detail,70))}</strong></div>`).join('');
  const maxWaterfallMs = Math.max(1,...scan.requests.map((request)=>(request.timing?.startOffsetMs||0)+(request.durationMs||0)));
  $('request-list').innerHTML = table(['Page / resource','Method','Status','Type','Destination','Waterfall','Time','Transfer','Fields','Phase'], scan.requests.slice(0,500).map((r) => [
    `<strong>${esc(short(r.url,85))}</strong><div class="muted">${esc(short(r.observedOn,75))}</div>`,
    esc(r.method), esc(r.status ?? (r.failed ? 'Failed' : '—')), esc(r.resourceType),
    `${esc(r.vendor||r.host)}${r.isThirdParty ? ' <span class="pill warn">Third party</span>' : ''}`,
    r.durationMs == null ? '—' : `<div class="waterfall-track" title="DNS ${esc(r.timing?.dnsMs??'—')} ms · Connect ${esc(r.timing?.connectionMs??'—')} ms · TLS ${esc(r.timing?.tlsMs??'—')} ms · TTFB ${esc(r.timing?.ttfbMs??'—')} ms · Download ${esc(r.timing?.downloadMs??'—')} ms"><i style="left:${Math.min(98,Math.max(0,100*(r.timing?.startOffsetMs||0)/maxWaterfallMs))}%;width:${Math.min(100,Math.max(2,100*r.durationMs/maxWaterfallMs))}%"></i></div>`,
    esc(r.durationMs == null ? '—' : `${r.durationMs} ms`), esc(bytes(r.transferBytes)),
    esc([...(r.queryFields||[]),...(r.bodyFields||[])].map((field)=>field.name).join(', ')||'—'),
    esc(r.phase === 'after_consent_action' ? 'After consent' : 'Before consent'),
  ]));
  $('technology-list').innerHTML = table(['Technology','Category','Confidence','Country','Evidence'],scan.technologies.map((t) => [esc(t.name),esc(t.category),`<span class="pill">${esc(t.confidence)}</span>`,esc(t.destinationCountry||'—'),esc(short(t.evidence.map((e)=>e.value).join(', '),100))]));
  $('page-list').innerHTML = table(['Page','Status','Title','Load','Forms','SEO','Security'],scan.pages.map((p) => [
    `<details><summary>${esc(short(p.finalUrl||p.url,90))}</summary><div class="muted">Description: ${esc(p.description||'—')}<br>Canonical: ${esc(p.canonical||'—')}<br>Headings: ${esc(Object.entries(p.headings||{}).map(([k,v])=>`${k}: ${v}`).join(', '))}<br>Frames: ${esc((p.frames||[]).join(', ')||'—')}<br>Forms: ${esc((p.forms||[]).map((form)=>`${form.method} ${form.action} (${form.fields.map((field)=>field.name).join(', ')})`).join('; ')||'—')}</div></details>`,
    esc(p.status||'—'),esc(short(p.title||'—',60)),esc(p.performance?.loadMs == null ? '—' : `${p.performance.loadMs} ms`),esc(p.forms?.length||0),esc(p.seo?.robots||'—'),p.url.startsWith('https:') ? p.securityHeaders?.['strict-transport-security'] ? '<span class="pill">HSTS</span>' : '<span class="pill warn">No HSTS</span>' : 'HTTP']));
  $('finding-list').innerHTML = insights.findings.length ? insights.findings.slice(0,100).map((f) => `<div class="finding"><div><strong>${esc(f.kind.replaceAll('_',' '))}</strong><small>${esc(short(f.page,100))} · ${esc(f.evidence)}</small></div><span class="pill ${f.severity==='warning'?'warn':''}">${esc(f.confidence)}</span></div>`).join('') : '<div class="card empty">No findings from the checks currently implemented.</div>';
  history();
}

async function openScan(id) {
  $('report').hidden = true;
  $('status').textContent = 'Loading scan…';
  const result = await fetch(`/api/scans/${id}`).then((r)=>r.json());
  if (result.status === 'completed') { render(id,result.scan,result.insights); $('status').textContent = 'Scan ready.'; }
  else $('status').textContent = result.error || result.stage || 'Scan is still running.';
}

$('demo-button').addEventListener('click', () => { void openScan('demo'); });

$('scan-form').addEventListener('submit',async (event) => {
  event.preventDefault();
  $('report').hidden = true;
  $('scan-button').disabled = true; $('status').textContent = 'Starting Chromium scan…';
  try {
    let storageState;
    const sessionFile = $('session-file').files[0];
    if (sessionFile) {
      if (sessionFile.size > 800000) throw new Error('Session file is too large (800 KB maximum).');
      try { storageState = JSON.parse(await sessionFile.text()); }
      catch { throw new Error('Session file is not valid JSON.'); }
      if (!storageState || !Array.isArray(storageState.cookies) || !Array.isArray(storageState.origins)) throw new Error('Select a Playwright storageState JSON file.');
    }
    const result = await fetch('/api/scans',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:$('url').value,maxPages:Number($('pages-limit').value),maxDepth:Number($('depth-limit').value),device:$('device').value,mode:$('mode').value,storageState})}).then((r)=>r.json());
    if (!result.id) throw new Error(result.error || 'Could not start scan');
    for (;;) {
      await new Promise((resolve)=>setTimeout(resolve,1500));
      const job = await fetch(`/api/scans/${result.id}`).then((r)=>r.json());
      if (job.status === 'completed') { render(result.id,job.scan,job.insights); $('status').textContent = 'Scan complete.'; break; }
      if (job.status === 'failed') throw new Error(job.error);
      $('status').textContent = `${job.stage || 'Scanning'} ${$('url').value}…`;
    }
  } catch (error) { $('status').textContent = error.message; }
  finally { $('scan-button').disabled = false; }
});

$('history-list').addEventListener('click',async (event) => {
  const open = event.target.closest('[data-open]');
  const compare = event.target.closest('[data-compare]');
  if (open) { await openScan(open.dataset.open); window.scrollTo({top:0,behavior:'smooth'}); }
  if (compare && selectedId) {
    const diff = await fetch(`/api/scans/${selectedId}/compare?with=${compare.dataset.compare}`).then((r)=>r.json());
    $('status').textContent = `New since comparison: ${diff.destinations?.length||0} destinations, ${diff.technologies?.length||0} technologies, ${diff.cookies?.length||0} cookies, ${diff.dataFields?.length||0} fields.`;
    window.scrollTo({top:0,behavior:'smooth'});
  }
});
history().catch((error)=>{ $('status').textContent = error.message; });
