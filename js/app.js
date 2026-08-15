(() => {
'use strict';

/* ---------------- element helper ---------------- */
function h(tag, props, ...children){
  const el = document.createElement(tag);
  if(props) for(const [k,v] of Object.entries(props)){
    if(k === 'style') Object.assign(el.style, v);
    else if(k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if(k === 'class') el.className = v;
    else if(v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for(const c of children.flat(Infinity)){
    if(c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(c) : c);
  }
  return el;
}

/* ---------------- date helpers ---------------- */
const DAY_MS = 86400000;
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function pad2(n){ return n < 10 ? '0'+n : ''+n; }
function dateKey(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function keyToDate(k){ const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(d, n){ return new Date(d.getTime() + n*DAY_MS); }
function fmtDateLine(d){ return WEEKDAYS[d.getDay()]+' '+d.getDate()+' '+MONTHS[d.getMonth()]; }
function partOfDay(d){ const h=d.getHours(); if(h<5) return 'night'; if(h<12) return 'morning'; if(h<17) return 'afternoon'; if(h<21) return 'evening'; return 'night'; }
function startOfWeek(d){ const day=d.getDay(); return addDays(new Date(d.getFullYear(),d.getMonth(),d.getDate()), -day); }

/* ---------------- persistence ---------------- */
const STORAGE_KEY = 'reading-tracker-state-v1';

function emptyState(){
  return {books: [], log: {}, currentId: null, tab: 'today', draft: {}, padOpen:false, padValue:'', addOpen:false, toast:'', nf:{title:'',author:'',pages:'',cover:null}};
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      // volatile UI fields are never persisted; restore fresh
      parsed.tab = parsed.tab || 'today';
      parsed.draft = {};
      parsed.padOpen = false; parsed.padValue = '';
      parsed.addOpen = false; parsed.toast = '';
      parsed.nf = {title:'',author:'',pages:'',cover:null};
      return parsed;
    }
  }catch(e){ /* fall through to empty */ }
  return emptyState();
}

function persist(){
  const {books, log, currentId} = state;
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({books, log, currentId})); }catch(e){ /* storage unavailable */ }
}

/* ---------------- state ---------------- */
let state = loadState();
let toastTimer = null;

function setState(patch){
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  persist();
  render();
}

function currentBook(){ return state.books.find(b => b.id === state.currentId) || state.books.find(b => !b.finishedDate) || null; }

function draftFor(book){
  return book.id in state.draft ? state.draft[book.id] : book.page;
}

function clampPage(v, book){ return Math.max(0, Math.min(book.pages, Math.round(v))); }

function setDraft(book, v){
  state.draft = Object.assign({}, state.draft, {[book.id]: clampPage(v, book)});
  persist(); render();
}

function flash(text){
  state.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = ''; render(); }, 2400);
  render();
}

function todayKey(){ return dateKey(new Date()); }

function logPages(delta){
  if(delta <= 0) return;
  const k = todayKey();
  state.log = Object.assign({}, state.log, {[k]: (state.log[k]||0) + delta});
}

function saveProgress(){
  const book = currentBook();
  const draft = draftFor(book);
  const delta = draft - book.page;
  const finishing = draft >= book.pages;
  logPages(delta);
  state.books = state.books.map(b => b.id === book.id
    ? Object.assign({}, b, {page: draft, finishedDate: finishing ? todayKey() : b.finishedDate})
    : b);
  const nd = Object.assign({}, state.draft); delete nd[book.id];
  state.draft = nd;
  persist();
  flash(finishing ? ('Finished ' + book.title + ' — nice.') : (delta > 0 ? (delta + ' pages today. Saved.') : 'Saved.'));
}

/* ---------------- derived stats ---------------- */
function daysReadThisMonth(){
  const now = new Date();
  let count = 0;
  for(const k in state.log){
    if(state.log[k] <= 0) continue;
    const d = keyToDate(k);
    if(d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d <= now) count++;
  }
  return count;
}

function fortnightData(){
  const today = new Date();
  const out = [];
  for(let i = 13; i >= 0; i--){
    const d = addDays(today, -i);
    out.push({read: (state.log[dateKey(d)]||0) > 0, isToday: i === 0});
  }
  return out;
}

function weeksData(){
  const today = new Date();
  const weeks = [];
  for(let w = 7; w >= 0; w--){
    const wkStart = addDays(startOfWeek(today), -7*w);
    let total = 0;
    for(let i = 0; i < 7; i++){
      const d = addDays(wkStart, i);
      if(d > today) break;
      total += state.log[dateKey(d)] || 0;
    }
    weeks.push({total, isNow: w === 0, label: w === 0 ? 'now' : ('w'+(8-w))});
  }
  return weeks;
}

function dayGridData(){
  const today = new Date();
  const cells = [];
  for(let i = 34; i >= 0; i--){
    const d = addDays(today, -i);
    const pages = state.log[dateKey(d)] || 0;
    cells.push(pages >= 20 ? 2 : pages > 0 ? 1 : 0);
  }
  return cells;
}

function yearStats(){
  const year = new Date().getFullYear();
  let pages = 0, books = 0;
  for(const k in state.log){ if(keyToDate(k).getFullYear() === year) pages += state.log[k]; }
  for(const b of state.books){ if(b.finishedDate && keyToDate(b.finishedDate).getFullYear() === year) books++; }
  // longest run of consecutive read-days within the year
  const keys = Object.keys(state.log).filter(k => keyToDate(k).getFullYear() === year && state.log[k] > 0).sort();
  let longest = 0, run = 0, prev = null;
  for(const k of keys){
    const d = keyToDate(k);
    if(prev && (d - prev) === DAY_MS) run++; else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return {pages, books, longest};
}

function restCopy(fort, daysRead){
  const yestRead = fort[12] && fort[12].read;
  if(!yestRead) return "A rest day yesterday — the thread carries on. " + daysRead + " days read this month.";
  return daysRead + " days read this month.";
}

/* ---------------- image capture ---------------- */
function readAsDataUrl(file, cb){
  const reader = new FileReader();
  reader.onload = () => cb(reader.result);
  reader.readAsDataURL(file);
}

/* ---------------- screen: today ---------------- */
function coverSlot(book, extraClass, onPick){
  const hasCover = !!book.cover;
  return h('label', {class: extraClass || 'cover-slot'},
    h('input', {type:'file', accept:'image/*', capture:'environment', onchange: e => {
      const f = e.target.files && e.target.files[0];
      if(f) readAsDataUrl(f, onPick);
    }}),
    hasCover
      ? h('div', {class:'cover-img', style:{backgroundImage:`url("${book.cover}")`}})
      : h('div', {class:'cover-placeholder'}, h('div', {class:'cam-icon'}), h('span', {}, 'snap it'))
  );
}

function renderTodayEmpty(){
  const now = new Date();
  return h('div', {class:'screen'},
    h('div', {class:'today-header'},
      h('div', {class:'date'}, fmtDateLine(now)),
      h('div', {class:'clock'}, partOfDay(now))
    ),
    h('div', {class:'empty-today'},
      h('div', {class:'empty-today-title'}, 'Nothing on the shelf yet'),
      h('p', {class:'empty-today-copy'}, "Add a book to start logging pages. Everything you add stays on this device."),
      h('button', {class:'save-btn', onclick:() => setState({addOpen:true})}, '+ Add a book')
    )
  );
}

function renderToday(){
  const book = currentBook();
  if(!book) return renderTodayEmpty();
  const draft = draftFor(book);
  const now = new Date();
  const today = draft - book.page;
  const left = book.pages - draft;
  const finishing = draft >= book.pages;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const goal = 30;
  const fort = fortnightData();
  const daysRead = daysReadThisMonth();
  const weeks = weeksData();
  const maxWeek = Math.max(1, ...weeks.map(w => w.total));

  const frag = h('div', {class:'screen'},
    h('div', {class:'today-header'},
      h('div', {class:'date'}, fmtDateLine(now)),
      h('div', {class:'clock'}, partOfDay(now))
    ),
    h('div', {class:'book-row'},
      coverSlot(book, 'cover-slot', url => {
        state.books = state.books.map(b => b.id === book.id ? Object.assign({}, b, {cover:url}) : b);
        persist(); render();
      }),
      h('div', {class:'book-meta'},
        h('div', {class:'book-title'}, book.title),
        h('div', {class:'book-author'}, book.author),
        h('div', {class:'book-meta-row'},
          h('span', {class:'book-remaining'}, left > 0 ? (left + ' pages left') : 'last page'),
          h('button', {class:'btn-pill', onclick:() => setState({tab:'books'})}, 'Switch book')
        )
      )
    ),
    h('div', {class:'card log-card'},
      h('div', {class:'log-card-head'},
        h('div', {class:'log-label'}, "I'm on page"),
        h('div', {class:'page-delta'}, today > 0 ? ('+'+today+' today') : 'not yet today')
      ),
      h('div', {class:'page-num-row'},
        h('button', {class:'page-num-btn', onclick:() => setState({padOpen:true, padValue:''})}, String(draft)),
        h('div', {class:'page-of'}, 'of ' + book.pages)
      ),
      h('input', {type:'range', min:0, max:book.pages, value:draft, oninput: e => setDraft(book, +e.target.value)}),
      h('div', {class:'step-row'},
        h('button', {class:'step-btn', onclick:() => setDraft(book, draft-10)}, '−10'),
        h('button', {class:'step-btn', onclick:() => setDraft(book, draft-1)}, '−1'),
        h('button', {class:'step-btn pos', onclick:() => setDraft(book, draft+1)}, '+1'),
        h('button', {class:'step-btn pos', onclick:() => setDraft(book, draft+10)}, '+10')
      ),
      h('button', {class:'save-btn', onclick: () => { saveProgress(); render(); }},
        finishing ? 'Finished — move to shelf' : ('Save page ' + draft))
    ),
    h('div', {class:'stat-row'},
      h('div', {class:'stat-card'},
        h('div', {class:'stat-label'}, 'Days read'),
        h('div', {class:'stat-value'}, String(daysRead)),
        h('div', {class:'stat-sub'}, 'this month')
      ),
      h('div', {class:'stat-card'},
        h('div', {class:'stat-label'}, 'Today'),
        h('div', {class:'stat-value'}, String(Math.max(0,today))),
        h('div', {class:'stat-bar'}, h('div', {class:'stat-bar-fill', style:{width: Math.min(100, Math.round(Math.max(0,today)/goal*100))+'%'}}))
      ),
      h('div', {class:'stat-card'},
        h('div', {class:'stat-label'}, 'Left'),
        h('div', {class:'stat-value'}, String(Math.max(0,left))),
        h('div', {class:'stat-sub'}, left === 1 ? 'page to go' : 'pages to go')
      )
    ),
    h('div', {class:'card fortnight-card'},
      h('div', {class:'fortnight-head'},
        h('div', {class:'log-label'}, 'Last two weeks'),
        h('div', {class:'page-delta'}, fmtRange(addDays(now,-13), now))
      ),
      h('div', {class:'fortnight-row'},
        h('div', {class:'fortnight-line'}),
        ...fort.map(d => h('div', {class:'fortnight-day'},
          d.read
            ? h('div', {class:'dot-read' + (d.isToday ? ' today-dot' : '')})
            : h('div', {class:'dot-rest'})
        ))
      ),
      h('div', {class:'rest-copy'}, restCopy(fort, daysRead))
    )
  );
  return frag;
}

function fmtRange(a, b){
  return a.getDate() + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()].slice(0,3);
}

/* ---------------- screen: books ---------------- */
function renderBooks(){
  const reading = state.books.filter(b => !b.finishedDate);
  const finished = state.books.filter(b => b.finishedDate).sort((a,b) => keyToDate(b.finishedDate) - keyToDate(a.finishedDate));

  return h('div', {class:'screen'},
    h('div', {class:'books-head'},
      h('div', {class:'books-title'}, 'Shelf'),
      h('button', {class:'btn-add', onclick:() => setState({addOpen:true})}, '+ Add')
    ),
    h('div', {class:'section-label'}, 'Reading · tap one to log against it'),
    reading.length
      ? h('div', {class:'shelf-list'}, ...reading.map(b => {
          const draft = draftFor(b);
          const isCurrent = b.id === state.currentId;
          const pct = Math.round((isCurrent ? draft : b.page) / b.pages * 100) + '%';
          return h('button', {class:'shelf-item', onclick:() => setState({currentId:b.id, tab:'today'})},
            h('div', {class:'shelf-cover'}, b.cover ? h('div', {class:'cover-img', style:{backgroundImage:`url("${b.cover}")`}}) : null),
            h('div', {class:'shelf-meta'},
              h('div', {class:'shelf-title-row'},
                h('div', {class:'shelf-title'}, b.title),
                isCurrent ? h('span', {class:'badge-current'}, 'Reading now') : null
              ),
              h('div', {class:'shelf-author'}, b.author),
              h('div', {class:'shelf-bar'}, h('div', {class:'shelf-bar-fill', style:{width:pct}})),
              h('div', {class:'shelf-status'}, 'page ' + (isCurrent ? draft : b.page) + ' of ' + b.pages)
            )
          );
        }))
      : h('div', {class:'empty-note'}, "Nothing on the go — add a book to start."),
    h('div', {class:'section-label'}, 'Finished · ' + finished.length),
    finished.length
      ? h('div', {class:'finished-list'}, ...finished.map(b => h('div', {class:'finished-item'},
          h('div', {class:'finished-dot'}),
          h('div', {},
            h('div', {class:'finished-title'}, b.title),
            h('div', {class:'finished-status'}, b.author + ' · finished ' + fmtShort(keyToDate(b.finishedDate)))
          )
        )))
      : h('div', {class:'empty-note'}, 'No finished books yet.')
  );
}

function fmtShort(d){ return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0,3); }

/* ---------------- screen: progress ---------------- */
function renderProgress(){
  const weeks = weeksData();
  const maxWeek = Math.max(1, ...weeks.map(w => w.total));
  const grid = dayGridData();
  const year = yearStats();

  return h('div', {class:'screen'},
    h('div', {class:'progress-title'}, 'Progress'),
    h('div', {class:'card prog-card'},
      h('div', {class:'log-label'}, 'Pages a week'),
      h('div', {class:'weeks-row', style:{marginTop:'14px'}}, ...weeks.map(w =>
        h('div', {class:'week-col'},
          h('div', {class:'week-bar' + (w.isNow ? ' now' : ''), style:{height: Math.max(2, Math.round(w.total/maxWeek*100))+'%'}}),
          h('div', {class:'week-label'}, w.label)
        )
      ))
    ),
    h('div', {class:'card prog-card'},
      h('div', {class:'prog-card-head'},
        h('div', {class:'log-label'}, 'Days read'),
        h('div', {class:'page-delta'}, 'last 5 weeks')
      ),
      h('div', {class:'day-grid'}, ...grid.map(v => h('div', {class:'day-cell', style:{background: v===2 ? 'var(--accent)' : v===1 ? 'var(--clay-light)' : '#EDE4D3'}}))),
      h('div', {class:'grid-legend'},
        h('div', {class:'grid-legend-item'}, h('div', {class:'grid-swatch', style:{background:'#EDE4D3'}}), 'no pages'),
        h('div', {class:'grid-legend-item'}, h('div', {class:'grid-swatch', style:{background:'var(--clay-light)'}}), 'a little'),
        h('div', {class:'grid-legend-item'}, h('div', {class:'grid-swatch', style:{background:'var(--accent)'}}), 'a lot')
      )
    ),
    h('div', {class:'card prog-card'},
      h('div', {class:'log-label', style:{marginBottom:'12px', display:'block'}}, 'This year'),
      h('div', {class:'year-row'},
        h('div', {}, h('div', {class:'year-num'}, String(year.books)), h('div', {class:'year-label'}, 'books finished')),
        h('div', {}, h('div', {class:'year-num'}, year.pages.toLocaleString()), h('div', {class:'year-label'}, 'pages read')),
        h('div', {}, h('div', {class:'year-num'}, year.longest + ' d'), h('div', {class:'year-label'}, 'longest run'))
      )
    )
  );
}

/* ---------------- nav ---------------- */
function renderNav(){
  return h('div', {class:'navbar'},
    h('button', {class:'nav-btn' + (state.tab==='today'?' active':''), onclick:() => setState({tab:'today'})},
      h('div', {class:'nav-icon today'}), h('span', {}, 'Today')),
    h('button', {class:'nav-btn' + (state.tab==='books'?' active':''), onclick:() => setState({tab:'books'})},
      h('div', {class:'nav-icon books'}), h('span', {}, 'Books')),
    h('button', {class:'nav-btn' + (state.tab==='progress'?' active':''), onclick:() => setState({tab:'progress'})},
      h('div', {class:'nav-icon progress'}), h('span', {}, 'Progress'))
  );
}

/* ---------------- page pad sheet ---------------- */
function renderPagePad(){
  if(!state.padOpen) return null;
  const book = currentBook();
  const value = state.padValue || String(draftFor(book));
  const keys = ['1','2','3','4','5','6','7','8','9','←','0','✓'];
  const press = k => {
    if(k === '←') setState({padValue: state.padValue.slice(0,-1)});
    else if(k === '✓') commitPad();
    else setState({padValue: (state.padValue + k).slice(0,4)});
  };
  return h('div', {class:'overlay', onclick: e => { if(e.target === e.currentTarget) setState({padOpen:false}); }},
    h('div', {class:'sheet'},
      h('div', {class:'pad-value'}, value),
      h('div', {class:'pad-grid'}, ...keys.map(k => h('button', {class:'pad-key', onclick:() => press(k)}, k))),
      h('button', {class:'pad-done', onclick: commitPad}, 'Set page')
    )
  );
}

function commitPad(){
  const book = currentBook();
  const v = state.padValue;
  state.padOpen = false;
  if(v) setDraft(book, +v); else render();
}

/* ---------------- add book sheet ---------------- */
function renderAddSheet(){
  if(!state.addOpen) return null;
  const nf = state.nf;
  // typing must not trigger a re-render (it would rebuild the input and drop focus);
  // only mutate the model silently, and re-render for changes that need a visual update (the cover preview)
  const setNfSilent = (k,v) => { state.nf = Object.assign({}, state.nf, {[k]:v}); };
  const setNf = (k,v) => { setNfSilent(k,v); render(); };
  return h('div', {class:'overlay', onclick: e => { if(e.target === e.currentTarget) setState({addOpen:false}); }},
    h('div', {class:'sheet'},
      h('div', {class:'sheet-title'}, 'Add a book'),
      h('div', {class:'add-form'},
        h('label', {class:'add-cover'},
          h('input', {type:'file', accept:'image/*', capture:'environment', onchange: e => {
            const f = e.target.files && e.target.files[0];
            if(f) readAsDataUrl(f, url => setNf('cover', url));
          }}),
          nf.cover
            ? h('div', {class:'cover-img', style:{backgroundImage:`url("${nf.cover}")`}})
            : h('div', {class:'cover-placeholder'}, h('div', {class:'cam-icon'}), h('span', {}, 'Photograph', h('br'), 'the cover'))
        ),
        h('div', {class:'add-fields'},
          h('input', {value:nf.title, placeholder:'Title', oninput: e => setNfSilent('title', e.target.value)}),
          h('input', {value:nf.author, placeholder:'Author', oninput: e => setNfSilent('author', e.target.value)}),
          h('input', {value:nf.pages, placeholder:'Pages', inputmode:'numeric', oninput: e => {
            const digits = e.target.value.replace(/[^0-9]/g,'');
            if(e.target.value !== digits) e.target.value = digits;
            setNfSilent('pages', digits);
          }})
        )
      ),
      h('div', {class:'add-actions'},
        h('button', {class:'btn-cancel', onclick:() => setState({addOpen:false})}, 'Cancel'),
        h('button', {class:'btn-confirm', onclick: addBook}, 'Add to shelf')
      )
    )
  );
}

function addBook(){
  const nf = state.nf;
  if(!nf.title.trim()){ setState({addOpen:false}); return; }
  const book = {id: Date.now(), title: nf.title.trim(), author: nf.author.trim() || '—', pages: +nf.pages || 300, page: 0, cover: nf.cover, finishedDate: null};
  state.books = state.books.concat([book]);
  state.addOpen = false;
  state.nf = {title:'',author:'',pages:'',cover:null};
  persist();
  flash('Added to your shelf.');
}

/* ---------------- toast ---------------- */
function renderToast(){
  if(!state.toast) return null;
  return h('div', {class:'toast'}, state.toast);
}

/* ---------------- root render ---------------- */
function render(){
  const root = document.getElementById('app');
  root.innerHTML = '';
  const screen = state.tab === 'today' ? renderToday() : state.tab === 'books' ? renderBooks() : renderProgress();
  root.appendChild(screen);
  root.appendChild(renderNav());
  const pad = renderPagePad(); if(pad) root.appendChild(pad);
  const add = renderAddSheet(); if(add) root.appendChild(add);
  const toast = renderToast(); if(toast) root.appendChild(toast);
}

render();

/* ---------------- PWA: service worker ---------------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is best-effort */ });
  });
}
})();
