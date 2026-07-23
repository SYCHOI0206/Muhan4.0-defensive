(function(){
  'use strict';
  if(!window.V40DefensiveCore || typeof window.__v40ApplyManualDay!=='function'){
    console.error('포트폴리오 분석 모듈이 방어형 엔진 연결에 실패했습니다.');
    return;
  }

  const Core=window.V40DefensiveCore;
  const baseReplay=window.replay;
  const baseStateBeforeDate=window.stateBeforeDate;
  const baseRender=window.render;
  const baseSave=window.save;
  const APPLY_MANUAL=window.__v40ApplyManualDay;
  const VERSION=18;
  let rangeMode='ALL';
  window.__V40_PORTFOLIO_ANALYTICS_ACTIVE__=true;
  window.__V40_PORTFOLIO_ANALYTICS_VERSION__='v18-cashflow-cycle-assets';
  window.__v18LegacyReplay=baseReplay;

  function byId(id){return document.getElementById(id)}
  function num(v,f){const x=Number(v);return Number.isFinite(x)?x:(f==null?0:f)}
  function clone(x){return JSON.parse(JSON.stringify(x))}
  function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]))}
  function fmtMoney(v){const x=num(v,0);return (x<0?'-$':'$')+Math.abs(x).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function signedMoney(v){const x=num(v,0);return x>0?'+'+fmtMoney(x):x<0?'-'+fmtMoney(Math.abs(x)):fmtMoney(0)}
  function pct(v){const x=num(v,0);return (x>0?'+':'')+x.toFixed(2)+'%'}
  function todayLocal(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
  function priorValues(prior){return (prior||[]).map(x=>Number(x&&x.close!=null?x.close:x)).filter(Number.isFinite)}
  function eventText(e){return typeof e==='string'?e:(e&&e.text?e.text:String(e||''))}
  function flowSigned(flow,applied){const a=applied==null?num(flow.amount,0):num(applied,0);return flow.type==='WITHDRAWAL'?-a:a}
  function flowLabel(type){return type==='WITHDRAWAL'?'출금':'입금'}
  function timingLabel(t){return t==='AFTER_TRADE'?'거래 후':'거래 전'}
  function shortDate(d){return String(d||'').replace(/^\d{4}-/,'').replace('-','.')}

  function ensureSchema(){
    if(!S || typeof S!=='object')return;
    if(!Array.isArray(S.records))S.records=[];
    if(!Array.isArray(S.cashFlows))S.cashFlows=[];
    S.cashFlows=S.cashFlows.map((f,i)=>({
      id:f&&f.id!=null?f.id:(Date.now()+i),
      date:String(f&&f.date||todayLocal()),
      type:String(f&&f.type||'DEPOSIT').toUpperCase()==='WITHDRAWAL'?'WITHDRAWAL':'DEPOSIT',
      amount:Math.max(0,num(f&&f.amount,0)),
      timing:String(f&&f.timing||'BEFORE_TRADE').toUpperCase()==='AFTER_TRADE'?'AFTER_TRADE':'BEFORE_TRADE',
      memo:String(f&&f.memo||'')
    })).filter(f=>f.date&&f.amount>0);
    S.schemaVersion=Math.max(num(S.schemaVersion,0),VERSION);
  }

  window.save=function(){ensureSchema();return baseSave()};
  ensureSchema();

  function sortedFlows(){
    ensureSchema();
    return S.cashFlows.slice().sort((a,b)=>a.date.localeCompare(b.date)||(a.timing==='BEFORE_TRADE'?0:1)-(b.timing==='BEFORE_TRADE'?0:1)||num(a.id)-num(b.id));
  }
  function sortedRecords(){return S.records.slice().sort((a,b)=>a.date.localeCompare(b.date)||num(a.id)-num(b.id))}

  function applyFlow(a,flow,strict){
    const requested=Math.max(0,num(flow.amount,0));
    let applied=requested,warning='';
    if(flow.type==='WITHDRAWAL'){
      if(requested>a.cash+1e-8){
        if(strict)throw new Error(flow.date+' 출금액 '+fmtMoney(requested)+'이 당시 현금 '+fmtMoney(a.cash)+'을 초과합니다.');
        applied=Math.max(0,a.cash);warning='현금 부족으로 '+fmtMoney(applied)+'만 반영';
      }
      a.cash-=applied;
    }else a.cash+=applied;
    return {requested,applied,signed:flowSigned(flow,applied),warning};
  }

  function processRecord(a,rec,prior){
    const close=num(rec.close,0),beforeShares=a.shares;
    const act=rec.action||(rec.closeOnly?'CLOSE_ONLY':'AUTO');
    let events,objects=[],ma200;
    if(act==='AUTO'){
      const result=Core.processDay(a,close,priorValues(prior),Core.settings(S.settings));
      objects=result.events||[];events=objects.map(eventText);ma200=result.ma200;
    }else{
      events=APPLY_MANUAL(a,{...rec,action:act},close,prior);
      ma200=Core.ma200WithCurrent(priorValues(prior),close);
    }
    if(beforeShares>0&&a.shares>0)a.cycleDay=(a.cycleDay||0)+1;
    return {close,act,beforeShares,events,objects,ma200};
  }

  function cycleEventCounts(cycle,act,objects,before,after,date){
    const codes=(objects||[]).map(e=>e&&e.code).filter(Boolean);
    if(act==='QUARTER_SELL'||codes.includes('QUARTER_SELL'))cycle.quarterCount++;
    if(act==='CRASH_FOLLOWUP_BUY'||codes.includes('CRASH_FOLLOWUP_BUY'))cycle.crashBuyCount++;
    if(codes.includes('CRASH_FOLLOWUP_ORDER'))cycle.crashOrderCount++;
    if((before.mode!=='REVERSE'&&after.mode==='REVERSE')||codes.includes('REVERSE_ENTER'))cycle.reverseEntered=true;
    if(before.mode==='REVERSE'||after.mode==='REVERSE')cycle._reverseDates.add(date);
  }
  function updateCyclePoint(cycle,a,close,date){
    if(!cycle)return;
    const raw=Core.equity(a,close||0);
    const adjusted=raw-cycle.externalNet;
    cycle.maxT=Math.max(cycle.maxT,num(a.T,0));
    cycle.peakAdjusted=Math.max(cycle.peakAdjusted,adjusted);
    if(cycle.peakAdjusted>0)cycle.mdd=Math.min(cycle.mdd,adjusted/cycle.peakAdjusted-1);
    cycle.lastDate=date;
    cycle.lastAsset=raw;
  }
  function newCycle(before,date,close){
    const startAsset=Core.equity(before,close);
    return {number:num(before.cycle,1),startDate:date,endDate:null,startAsset,endAsset:null,realizedPnl:null,returnPct:null,assetChangeExFlow:null,externalNet:0,maxT:num(before.T,0),peakAdjusted:startAsset,mdd:0,quarterCount:0,crashOrderCount:0,crashBuyCount:0,reverseEntered:false,_reverseDates:new Set(),_tradeDates:new Set(),lastDate:date,lastAsset:startAsset,status:'ACTIVE'};
  }
  function finishCycle(cycle,after,date,close){
    cycle.endDate=date;cycle.endAsset=Core.equity(after,close);cycle.realizedPnl=num(after.lastCycleRealizedPnl,cycle.endAsset-cycle.startAsset-cycle.externalNet);cycle.returnPct=cycle.startAsset?cycle.realizedPnl/cycle.startAsset*100:0;cycle.assetChangeExFlow=cycle.endAsset-cycle.startAsset-cycle.externalNet;cycle.reverseDays=cycle._reverseDates.size;cycle.tradeDays=cycle._tradeDates.size;cycle.calendarDays=Math.max(1,Math.round((new Date(date+'T00:00:00Z')-new Date(cycle.startDate+'T00:00:00Z'))/86400000)+1);cycle.status='COMPLETED';delete cycle._reverseDates;delete cycle._tradeDates;return cycle;
  }
  function publicActiveCycle(cycle){
    if(!cycle)return null;
    const c={...cycle,reverseDays:cycle._reverseDates.size,tradeDays:cycle._tradeDates.size,status:'ACTIVE'};
    delete c._reverseDates;delete c._tradeDates;return c;
  }

  function buildReplay(options){
    options=options||{};ensureSchema();
    const a=account(),rows=[],prior=[],timeline=[],flowRows=[],cycles=[];
    const records=sortedRecords(),flows=sortedFlows();
    const dates=[...new Set(records.map(r=>r.date).concat(flows.map(f=>f.date)))].sort();
    let lastClose=0,active=null,cumDeposits=0,cumWithdrawals=0;

    function addTimeline(date){
      const close=lastClose||0,total=Core.equity(a,close),netPrincipal=num(S.settings.seed,0)+cumDeposits-cumWithdrawals;
      const point={date,totalAsset:total,netPrincipal,purePnl:total-netPrincipal,cash:a.cash,shares:a.shares,close:close||null,T:a.T};
      const prev=timeline[timeline.length-1];if(prev&&prev.date===date)timeline[timeline.length-1]=point;else timeline.push(point);
    }
    function handleFlow(flow){
      const result=applyFlow(a,flow,Boolean(options.strictFlows));
      if(flow.type==='DEPOSIT')cumDeposits+=result.applied;else cumWithdrawals+=result.applied;
      if(active){active.externalNet+=result.signed;updateCyclePoint(active,a,lastClose,flow.date)}
      flowRows.push({flow:clone(flow),applied:result.applied,warning:result.warning,cashAfter:a.cash});
    }

    for(const date of dates){
      const dayFlows=flows.filter(f=>f.date===date),dayRecords=records.filter(r=>r.date===date);
      dayFlows.filter(f=>f.timing==='BEFORE_TRADE').forEach(handleFlow);
      for(const rec of dayRecords){
        const before=clone(a),processed=processRecord(a,rec,prior),close=processed.close;
        lastClose=close;prior.push({date:rec.date,close});
        rows.push({rec,close,events:processed.events,a:clone(a),equity:Core.equity(a,close),revStar:typeof revStarFromPrior==='function'?revStarFromPrior(prior.slice(0,-1)):null,ma200:processed.ma200});
        if(processed.beforeShares<=0&&a.shares>0&&!active)active=newCycle(before,date,close);
        if(active){active._tradeDates.add(date);cycleEventCounts(active,processed.act,processed.objects,before,a,date);updateCyclePoint(active,a,close,date)}
        if(active&&processed.beforeShares>0&&a.shares<=0){cycles.push(finishCycle(active,a,date,close));active=null}
      }
      dayFlows.filter(f=>f.timing==='AFTER_TRADE').forEach(handleFlow);
      addTimeline(date);
    }
    if(!dates.length)addTimeline(todayLocal());
    return {a,rows,prior,timeline,flowRows,cycles,activeCycle:publicActiveCycle(active),cumulativeDeposits:cumDeposits,cumulativeWithdrawals:cumWithdrawals,lastClose};
  }

  window.replay=function(){return buildReplay({strictFlows:false})};
  window.stateBeforeDate=function(d){
    ensureSchema();const a=account(),prior=[];const records=sortedRecords(),flows=sortedFlows();
    const dates=[...new Set(records.map(r=>r.date).concat(flows.map(f=>f.date)))].sort();
    for(const date of dates){
      if(d&&date>d)break;
      const dayFlows=flows.filter(f=>f.date===date),dayRecords=records.filter(r=>r.date===date);
      dayFlows.filter(f=>f.timing==='BEFORE_TRADE').forEach(f=>applyFlow(a,f,false));
      if(d&&date===d)break;
      for(const rec of dayRecords){const p=processRecord(a,rec,prior);prior.push({date:rec.date,close:p.close})}
      dayFlows.filter(f=>f.timing==='AFTER_TRADE').forEach(f=>applyFlow(a,f,false));
    }
    return {a,prior};
  };

  function ensureStyles(){
    if(byId('portfolioV18Style'))return;
    const st=document.createElement('style');st.id='portfolioV18Style';st.textContent=`
      .portfolioSummary{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.portfolioMetric{background:#f8f5ff;border:1px solid #e7def7;border-radius:16px;padding:12px}.portfolioMetric .lab{font-size:10.5px;color:#776f88;font-weight:900}.portfolioMetric .val{font-size:17px;font-weight:950;margin-top:4px}.portfolioMetric .val.pos{color:#1b9a6f}.portfolioMetric .val.neg{color:#df4b4b}.analyticsToolbar{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.analyticsToolbar button{padding:8px 11px;font-size:11px;box-shadow:none}.analyticsToolbar button.active{background:#6f57e8;color:#fff}.assetChart{border:1px solid #e8e0f5;background:#fff;border-radius:16px;padding:8px;overflow:hidden}.assetLegend{display:flex;gap:12px;flex-wrap:wrap;font-size:10.5px;font-weight:850;color:#716a82;margin:5px 4px 9px}.assetLegend i{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:4px}.assetLegend .total{background:#765ff0}.assetLegend .principal{background:#efad3d}.assetLegend .profit{background:#2ba176}.cycleCard,.flowItem{border:1px solid #e8e0f5;border-radius:16px;padding:12px;margin:8px 0;background:#fff}.cycleHead,.flowHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.cycleTitle,.flowTitle{font-weight:950}.cycleSub,.flowSub{font-size:11px;color:#7c758b;margin-top:3px}.cycleGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}.cycleCell{background:#f8f5ff;border-radius:11px;padding:8px}.cycleCell span{display:block;font-size:9.5px;color:#7b748a;font-weight:850}.cycleCell b{font-size:12px}.flowAmount.deposit{color:#15966b}.flowAmount.withdrawal{color:#df4b4b}.flowDelete{padding:6px 9px!important;font-size:11px!important;box-shadow:none!important}.cashFlowBlock{margin-top:13px;border-top:1px solid #eee7f7;padding-top:12px}.cashFlowFormGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cashFlowFormGrid .wide{grid-column:1/-1}.cashFlowHint{font-size:11px;color:#7b748a;line-height:1.5;margin:7px 0}.emptyAnalytics{padding:18px;text-align:center;color:#827b90;background:#faf8ff;border:1px dashed #ded3f3;border-radius:15px}.csvButtons{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.csvButtons button{padding:8px 10px;font-size:11px;box-shadow:none}.seedWarning{color:#9b6713!important;font-weight:850}.performanceGrid{display:grid;grid-template-columns:1.2fr .8fr;gap:10px}.performanceGrid .card{margin-bottom:0}@media(max-width:700px){.portfolioSummary{grid-template-columns:1fr 1fr}.performanceGrid{grid-template-columns:1fr}.cycleGrid{grid-template-columns:1fr 1fr}.cashFlowFormGrid{grid-template-columns:1fr}.cashFlowFormGrid .wide{grid-column:auto}}
    `;document.head.appendChild(st);
  }

  function ensurePerformanceUi(){
    ensureStyles();
    const nav=document.querySelector('.nav');
    if(nav&&!byId('navPerformance')){const a=document.createElement('a');a.href='#performance';a.dataset.tab='performance';a.id='navPerformance';a.textContent='성과';const rules=nav.querySelector('a[href="#rules"]');nav.insertBefore(a,rules||null)}
    const wrap=document.querySelector('.wrap');
    if(wrap&&!byId('performance')){
      const sec=document.createElement('section');sec.id='performance';sec.innerHTML=`
        <div class="card"><h2>자산 성과 <span class="sub">입출금과 투자손익 분리</span></h2><div class="portfolioSummary">
          <div class="portfolioMetric"><div class="lab">총자산</div><div class="val" id="pfTotal">$0</div></div>
          <div class="portfolioMetric"><div class="lab">순투자원금</div><div class="val" id="pfPrincipal">$0</div></div>
          <div class="portfolioMetric"><div class="lab">순수 투자손익</div><div class="val" id="pfProfit">$0</div></div>
          <div class="portfolioMetric"><div class="lab">누적수익률</div><div class="val" id="pfReturn">0%</div></div>
        </div><div class="analyticsToolbar" id="assetRangeButtons"><button class="secondary active" data-range="ALL">전체</button><button class="secondary" data-range="1Y">1년</button><button class="secondary" data-range="6M">6개월</button><button class="secondary" data-range="CYCLE">현재 사이클</button></div><div id="assetChart" class="assetChart"></div></div>
        <div class="performanceGrid"><div class="card"><h2>사이클 자동 요약 <span class="sub">전량매도 기준</span></h2><div id="activeCycleBox"></div><div id="cycleList"></div><div class="csvButtons"><button class="secondary" id="exportCyclesCsv" type="button">사이클 CSV</button></div></div>
        <div class="card"><h2>입출금 원장 <span class="sub">설정 탭에서 기록</span></h2><div id="flowSummary"></div><div id="cashFlowList"></div><div class="csvButtons"><button class="secondary" id="exportFlowsCsv" type="button">입출금 CSV</button></div></div></div>`;
      const rules=byId('rules');wrap.insertBefore(sec,rules||null);
    }
    injectCashFlowSettings();bindAnalyticsUi();
  }

  function injectCashFlowSettings(){
    const rows=document.querySelector('#settingsSheet .settingRows');if(!rows||byId('cashFlowSettingsBlock'))return;
    const seedRow=byId('ss_seed')&&byId('ss_seed').closest('.settingRow');if(seedRow){const small=seedRow.querySelector('small');if(small){small.textContent='초기원금 수정은 과거 전체를 재계산합니다. 추가·회수 자금은 아래 입출금 기록을 사용하세요.';small.classList.add('seedWarning')}}
    const block=document.createElement('div');block.id='cashFlowSettingsBlock';block.className='cashFlowBlock';block.innerHTML=`<div style="font-weight:950;margin-bottom:7px">입출금 기록</div><div class="cashFlowHint">입출금은 투자손익과 분리해 원장에 남고, 이후 1회매수금과 총자산에 반영됩니다.</div><div class="cashFlowFormGrid">
      <div><label>구분</label><select id="cf_type"><option value="DEPOSIT">입금</option><option value="WITHDRAWAL">출금</option></select></div>
      <div><label>날짜</label><input id="cf_date" type="date"></div>
      <div><label>금액 ($)</label><input id="cf_amount" type="number" min="0" step="0.01" placeholder="예: 5000"></div>
      <div><label>반영 시점</label><select id="cf_timing"><option value="BEFORE_TRADE">거래 전</option><option value="AFTER_TRADE">거래 후</option></select></div>
      <div class="wide"><label>메모</label><input id="cf_memo" type="text" maxlength="80" placeholder="예: 추가 투자금"></div>
    </div><button id="addCashFlow" type="button" style="width:100%;margin-top:9px">입출금 기록 저장</button><div id="settingsFlowRecent"></div>`;
    rows.appendChild(block);if(byId('cf_date'))byId('cf_date').value=todayLocal();
  }

  function applySettingsSafe(){
    const oldSeed=num(S.settings.seed,0),newSeed=num(byId('ss_seed')&&byId('ss_seed').value,oldSeed);
    if(Math.abs(newSeed-oldSeed)>1e-9&&(S.records.length||S.cashFlows.length)){
      const ok=confirm('초기원금을 '+fmtMoney(oldSeed)+'에서 '+fmtMoney(newSeed)+'로 바꾸면 과거 전체 기록이 다시 계산됩니다.\n\n추가 입금이나 출금이라면 취소하고 아래 입출금 기록을 사용하세요.\n\n초기원금 자체를 변경하시겠습니까?');if(!ok){byId('ss_seed').value=oldSeed;return}
    }
    byId('seed').value=newSeed;byId('ticker').value=(byId('ss_ticker')&&byId('ss_ticker').value)||'SOXL';byId('split').value=num(byId('ss_split')&&byId('ss_split').value,S.settings.split);byId('starBase').value=num(byId('ss_starBase')&&byId('ss_starBase').value,S.settings.starBase);byId('target').value=num(byId('ss_target')&&byId('ss_target').value,S.settings.target);byId('quarter').value=num(byId('ss_quarter')&&byId('ss_quarter').value,S.settings.quarter);settingsFromInputs();save();render();if(typeof closeSettingsSheet==='function')closeSettingsSheet();
  }

  function addCashFlow(){
    const type=byId('cf_type').value,date=byId('cf_date').value,amount=num(byId('cf_amount').value,0),timing=byId('cf_timing').value,memo=byId('cf_memo').value.trim();
    if(!date||amount<=0){alert('입출금 날짜와 금액을 확인하세요.');return}
    const flow={id:Date.now(),date,type,amount,timing,memo};S.cashFlows.push(flow);
    try{buildReplay({strictFlows:true})}catch(e){S.cashFlows=S.cashFlows.filter(f=>f.id!==flow.id);alert(e.message);return}
    save();byId('cf_amount').value='';byId('cf_memo').value='';render();alert(flowLabel(type)+' '+fmtMoney(amount)+'이 기록되었습니다.');
  }
  function deleteCashFlow(id){
    const f=S.cashFlows.find(x=>String(x.id)===String(id));if(!f)return;if(!confirm(f.date+' '+flowLabel(f.type)+' '+fmtMoney(f.amount)+' 기록을 삭제할까요?'))return;S.cashFlows=S.cashFlows.filter(x=>String(x.id)!==String(id));save();render();
  }

  function filterTimeline(points,R){
    if(!points.length)return points;const last=new Date(points[points.length-1].date+'T00:00:00Z');let start=null;
    if(rangeMode==='1Y'){start=new Date(last);start.setUTCFullYear(start.getUTCFullYear()-1)}
    if(rangeMode==='6M'){start=new Date(last);start.setUTCMonth(start.getUTCMonth()-6)}
    if(rangeMode==='CYCLE'&&R.activeCycle)start=new Date(R.activeCycle.startDate+'T00:00:00Z');
    return start?points.filter(p=>new Date(p.date+'T00:00:00Z')>=start):points;
  }
  function samplePoints(points,max){if(points.length<=max)return points;const out=[];for(let i=0;i<max;i++){out.push(points[Math.round(i*(points.length-1)/(max-1))])}return out}
  function chartSvg(points){
    if(!points.length)return '<div class="emptyAnalytics">아직 표시할 자산 기록이 없습니다.</div>';
    points=samplePoints(points,140);const W=720,H=250,L=64,R=16,T=14,B=32,keys=['totalAsset','netPrincipal','purePnl'];let vals=[];points.forEach(p=>keys.forEach(k=>vals.push(num(p[k],0))));let lo=Math.min(...vals,0),hi=Math.max(...vals,0);if(hi===lo){hi+=1;lo-=1}const pad=(hi-lo)*.08;hi+=pad;lo-=pad;
    const x=i=>L+(W-L-R)*(points.length===1?.5:i/(points.length-1)),y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
    const path=k=>points.map((p,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(p[k]).toFixed(1)).join(' ');
    let grid='';for(let i=0;i<5;i++){const v=hi-(hi-lo)*i/4,yy=y(v);grid+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#eee8f7"/><text x="${L-7}" y="${yy+4}" text-anchor="end" font-size="10" fill="#8a8396">${Math.round(v).toLocaleString()}</text>`}
    const first=points[0].date,last=points[points.length-1].date,zero=y(0);
    return `<div class="assetLegend"><span><i class="total"></i>총자산</span><span><i class="principal"></i>순투자원금</span><span><i class="profit"></i>순수손익</span></div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="총자산 순투자원금 순수손익 추이">${grid}<line x1="${L}" y1="${zero}" x2="${W-R}" y2="${zero}" stroke="#cfc5df" stroke-dasharray="4 5"/><path d="${path('totalAsset')}" fill="none" stroke="#765ff0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="${path('netPrincipal')}" fill="none" stroke="#efad3d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="${path('purePnl')}" fill="none" stroke="#2ba176" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><text x="${L}" y="${H-7}" font-size="10" fill="#8a8396">${esc(shortDate(first))}</text><text x="${W-R}" y="${H-7}" text-anchor="end" font-size="10" fill="#8a8396">${esc(shortDate(last))}</text></svg>`;
  }

  function cycleCard(c,active){
    const title=active?`제${c.number}사이클 · 진행 중`:`제${c.number}사이클 · 완료`;
    const pnl=active?(c.lastAsset-c.startAsset-c.externalNet):c.realizedPnl,ret=active?(c.startAsset?pnl/c.startAsset*100:0):c.returnPct;
    return `<div class="cycleCard"><div class="cycleHead"><div><div class="cycleTitle">${title}</div><div class="cycleSub">${esc(c.startDate)}${c.endDate?' ~ '+esc(c.endDate):' ~ 현재'} · ${c.tradeDays||0}거래일</div></div><b class="${pnl>=0?'green':'red'}">${signedMoney(pnl)}</b></div><div class="cycleGrid"><div class="cycleCell"><span>수익률</span><b>${pct(ret)}</b></div><div class="cycleCell"><span>최대 T</span><b>${num(c.maxT,0).toFixed(2)}</b></div><div class="cycleCell"><span>사이클 MDD</span><b>${pct(num(c.mdd,0)*100)}</b></div><div class="cycleCell"><span>쿼터매도</span><b>${c.quarterCount||0}회</b></div><div class="cycleCell"><span>리버스</span><b>${c.reverseEntered?'진입 '+(c.reverseDays||0)+'일':'없음'}</b></div><div class="cycleCell"><span>급락 0.25T</span><b>${c.crashBuyCount||0}회</b></div></div></div>`;
  }
  function renderFlows(R){
    const list=byId('cashFlowList'),sum=byId('flowSummary');if(!list||!sum)return;
    sum.innerHTML=`<div class="portfolioSummary" style="grid-template-columns:1fr 1fr"><div class="portfolioMetric"><div class="lab">누적입금</div><div class="val pos">${fmtMoney(R.cumulativeDeposits)}</div></div><div class="portfolioMetric"><div class="lab">누적출금</div><div class="val neg">${fmtMoney(R.cumulativeWithdrawals)}</div></div></div>`;
    const rows=R.flowRows.slice().reverse();list.innerHTML=rows.length?rows.map(r=>{const f=r.flow,dep=f.type==='DEPOSIT';return `<div class="flowItem"><div class="flowHead"><div><div class="flowTitle">${esc(f.date)} · ${flowLabel(f.type)}</div><div class="flowSub">${timingLabel(f.timing)}${f.memo?' · '+esc(f.memo):''}${r.warning?' · '+esc(r.warning):''}</div></div><div><b class="flowAmount ${dep?'deposit':'withdrawal'}">${dep?'+':'-'}${fmtMoney(r.applied)}</b><button class="secondary flowDelete" data-delete-flow="${esc(f.id)}" type="button">삭제</button></div></div></div>`}).join(''):'<div class="emptyAnalytics">입출금 기록이 없습니다.</div>';
    document.querySelectorAll('[data-delete-flow]').forEach(b=>b.onclick=()=>deleteCashFlow(b.dataset.deleteFlow));
    const recent=byId('settingsFlowRecent');if(recent)recent.innerHTML=rows.slice(0,3).map(r=>`<div class="flowSub" style="margin-top:6px">${esc(r.flow.date)} · ${flowLabel(r.flow.type)} ${fmtMoney(r.applied)}</div>`).join('');
  }
  function renderAnalytics(){
    ensureSchema();ensurePerformanceUi();const R=buildReplay({strictFlows:false}),last=R.lastClose||0,total=Core.equity(R.a,last),principal=num(S.settings.seed,0)+R.cumulativeDeposits-R.cumulativeWithdrawals,profit=total-principal,ret=principal?profit/principal*100:0;
    byId('pfTotal').textContent=fmtMoney(total);byId('pfPrincipal').textContent=fmtMoney(principal);byId('pfProfit').textContent=signedMoney(profit);byId('pfProfit').className='val '+(profit>0?'pos':profit<0?'neg':'');byId('pfReturn').textContent=pct(ret);byId('pfReturn').className='val '+(ret>0?'pos':ret<0?'neg':'');
    const pnlEl=byId('pnl');if(pnlEl){pnlEl.textContent=pct(ret);pnlEl.className='val '+(ret>=0?'green':'red')}
    byId('assetChart').innerHTML=chartSvg(filterTimeline(R.timeline,R));
    byId('activeCycleBox').innerHTML=R.activeCycle?cycleCard(R.activeCycle,true):'<div class="emptyAnalytics">현재 진행 중인 사이클이 없습니다.</div>';
    byId('cycleList').innerHTML=R.cycles.length?R.cycles.slice().reverse().map(c=>cycleCard(c,false)).join(''):'<div class="emptyAnalytics">완료된 사이클이 없습니다.</div>';
    renderFlows(R);return R;
  }

  function csvCell(v){const s=String(v==null?'':v);return /[\",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
  function download(name,text,type){const blob=new Blob([text],{type:type||'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function exportCycles(){const R=buildReplay(),head=['cycle','start_date','end_date','start_asset','end_asset','realized_pnl','return_pct','mdd_pct','max_T','trade_days','calendar_days','quarter_count','reverse_days','crash_buy_count','external_net'];const lines=[head.join(',')];R.cycles.forEach(c=>lines.push([c.number,c.startDate,c.endDate,c.startAsset,c.endAsset,c.realizedPnl,c.returnPct,c.mdd*100,c.maxT,c.tradeDays,c.calendarDays,c.quarterCount,c.reverseDays,c.crashBuyCount,c.externalNet].map(csvCell).join(',')));download('SOXL_V4_cycles_'+todayLocal()+'.csv','\ufeff'+lines.join('\n'))}
  function exportFlows(){const R=buildReplay(),head=['date','type','amount','applied','timing','memo','cash_after','warning'];const lines=[head.join(',')];R.flowRows.forEach(r=>lines.push([r.flow.date,r.flow.type,r.flow.amount,r.applied,r.flow.timing,r.flow.memo,r.cashAfter,r.warning].map(csvCell).join(',')));download('SOXL_V4_cashflows_'+todayLocal()+'.csv','\ufeff'+lines.join('\n'))}

  function bindAnalyticsUi(){
    if(byId('portfolioBindingsDone'))return;const marker=document.createElement('i');marker.id='portfolioBindingsDone';marker.hidden=true;document.body.appendChild(marker);
    document.querySelectorAll('#assetRangeButtons [data-range]').forEach(b=>b.onclick=()=>{rangeMode=b.dataset.range;document.querySelectorAll('#assetRangeButtons button').forEach(x=>x.classList.toggle('active',x===b));renderAnalytics()});
    if(byId('exportCyclesCsv'))byId('exportCyclesCsv').onclick=exportCycles;if(byId('exportFlowsCsv'))byId('exportFlowsCsv').onclick=exportFlows;
    if(byId('addCashFlow'))byId('addCashFlow').onclick=addCashFlow;
    if(byId('applySettingsSheet'))byId('applySettingsSheet').onclick=applySettingsSafe;
    if(byId('navSettings'))byId('navSettings').addEventListener('click',()=>setTimeout(()=>{if(byId('cf_date')&&!byId('cf_date').value)byId('cf_date').value=todayLocal();renderFlows(buildReplay())},20));
    const init=byId('init');if(init)init.onclick=()=>{settingsFromInputs();S.records=[];S.cashFlows=[];S.orderQtyOverrides={};save();render();alert('초기자본 '+fmtMoney(S.settings.seed)+'으로 새로 시작합니다.')};
  }

  window.__v18BuildReplay=buildReplay;
  window.__v18ApplyFlow=applyFlow;
  if(window.__V18_HEADLESS_TEST__)return;

  window.render=function(){ensureSchema();const out=baseRender();renderAnalytics();return out};
  ensurePerformanceUi();bindAnalyticsUi();renderAnalytics();
})();
