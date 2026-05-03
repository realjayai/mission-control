const $=id=>document.getElementById(id);
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
let savedPassword='';
async function decrypt(password,payload){
  const keyMaterial=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(payload.salt),iterations:payload.iterations,hash:'SHA-256'},keyMaterial,{name:'AES-GCM',length:256},false,['decrypt']);
  const ct=b64(payload.data),tag=b64(payload.tag),merged=new Uint8Array(ct.length+tag.length);
  merged.set(ct); merged.set(tag,ct.length);
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(payload.iv)},key,merged);
  return JSON.parse(new TextDecoder().decode(raw));
}
function inline(s){return esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');}
function markdown(md){
  const lines=String(md||'').replace(/\r\n/g,'\n').split('\n');
  let html='', list=null;
  const close=()=>{if(list){html+='</'+list+'>'; list=null;}};
  for(const raw of lines){const line=raw.trimEnd();
    if(!line.trim()){close(); continue;}
    if(/^###\s+/.test(line)){close(); html+='<h3>'+inline(line.replace(/^###\s+/,''))+'</h3>'; continue;}
    if(/^##\s+/.test(line)){close(); html+='<h2>'+inline(line.replace(/^##\s+/,''))+'</h2>'; continue;}
    if(/^#\s+/.test(line)){close(); html+='<h1>'+inline(line.replace(/^#\s+/,''))+'</h1>'; continue;}
    if(/^>\s?/.test(line)){close(); html+='<blockquote>'+inline(line.replace(/^>\s?/,''))+'</blockquote>'; continue;}
    if(/^[-*]\s+/.test(line)){if(list!=='ul'){close(); list='ul'; html+='<ul>';} html+='<li>'+inline(line.replace(/^[-*]\s+/,''))+'</li>'; continue;}
    if(/^\d+\.\s+/.test(line)){if(list!=='ol'){close(); list='ol'; html+='<ol>';} html+='<li>'+inline(line.replace(/^\d+\.\s+/,''))+'</li>'; continue;}
    close(); html+='<p>'+inline(line)+'</p>';
  }
  close(); return html;
}
async function loadJson(path){const r=await fetch(path,{cache:'no-store'}); if(!r.ok) throw new Error(String(r.status)); return r.json();}
async function unlock(password){
  await decrypt(password,await loadJson('../data.json'));
  savedPassword=password;
  $('status').textContent='unlocked'; $('status').classList.add('ok'); $('unlock').classList.add('hidden'); $('app').classList.remove('hidden');
  let manifest={posts:[]};
  try{manifest=await decrypt(password,await loadJson('posts/index.enc.json'));}catch{manifest={posts:[]};}
  renderList(manifest.posts||[]);
}
function renderList(posts){
  listTitle.textContent=posts.length?`${posts.length} staged draft${posts.length===1?'':'s'}`:'No staged drafts yet';
  if(!posts.length){postList.innerHTML='<div class="empty">No finalized posts have been staged yet.</div>'; post.innerHTML='<p class="empty">Publish the first encrypted draft with the local publish script.</p>'; return;}
  postList.innerHTML=posts.map((p,i)=>`<button class="post-item ${i?'':'active'}" data-slug="${esc(p.slug)}"><strong>${esc(p.title)}</strong><span>${esc(p.summary||'')}</span></button>`).join('');
  postList.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>selectPost(btn.dataset.slug,posts,btn)));
  const wanted=decodeURIComponent(location.hash.replace(/^#/,''));
  const first=posts.find(p=>p.slug===wanted)||posts[0];
  const btn=postList.querySelector(`[data-slug="${CSS.escape(first.slug)}"]`)||postList.querySelector('button');
  selectPost(first.slug,posts,btn);
}
async function selectPost(slug,posts,btn){
  if(location.hash.replace(/^#/,'')!==slug) history.replaceState(null,'',`#${slug}`);
  postList.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===btn));
  const meta=posts.find(p=>p.slug===slug)||{};
  post.innerHTML='<p class="empty">Loading draft...</p>';
  try{
    const doc=await decrypt(savedPassword,await loadJson(`posts/${slug}.enc.json`));
    post.innerHTML=`<div class="meta"><span class="chip">${esc(doc.status||'staged')}</span><span class="chip">${esc(doc.date||meta.date||'')}</span><span class="chip">${esc(doc.source||meta.source||'Five One Nine')}</span></div>${markdown(doc.markdown)}`;
    document.title=`${doc.title||meta.title} | Five One Nine blog staging`;
  }catch(e){post.innerHTML='<p class="empty">Could not decrypt this draft. Check the password or republish the post.</p>';}
}
$('unlockForm').addEventListener('submit',async e=>{e.preventDefault(); $('msg').textContent='Unlocking...'; try{await unlock($('password').value); $('msg').textContent='';}catch{$('msg').textContent='Wrong password or dashboard verifier unavailable.';}});
