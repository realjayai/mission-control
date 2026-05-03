#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root = process.cwd();
const rawArgs = process.argv.slice(2);
const args = Object.fromEntries(rawArgs.map((a,i,arr)=>a.startsWith('--')?[a.slice(2),arr[i+1] && !arr[i+1].startsWith('--') ? arr[i+1] : true]:[]).filter(Boolean));
if (!args.file || !args.title) {
  throw new Error('Usage: node scripts/publish-blog-post.mjs --file draft.md --title "Title" --summary "Short summary"');
}

async function passwordFromUnlockedDashboard(){
  try {
    const tabs = await (await fetch('http://127.0.0.1:9222/json/list')).json();
    const tab = tabs.find(t => t.type === 'page' && t.url === 'https://realjayai.github.io/mission-control/');
    if (!tab?.webSocketDebuggerUrl) return '';
    let id = 0;
    const pending = new Map();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const send = (method, params={}) => {
      const mid = ++id;
      ws.send(JSON.stringify({id: mid, method, params}));
      return new Promise((resolve, reject) => pending.set(mid, {resolve, reject}));
    };
    await send('Runtime.enable');
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const app = document.querySelector('#app');
        const unlocked = app && !app.classList.contains('hidden');
        return unlocked ? (document.querySelector('#password')?.value || '') : '';
      })()`,
      returnByValue: true,
    });
    ws.close();
    return r?.result?.value || '';
  } catch {
    return '';
  }
}

function passwordFromPrompt(){
  if (!process.stdin.isTTY) return '';
  try {
    const tty = '/dev/tty';
    process.stdout.write('Blog staging password: ');
    execFileSync('stty', ['-echo'], {stdio: ['ignore', 'ignore', 'ignore']});
    const fd = fs.openSync(tty, 'r');
    const chunks = [];
    const buf = Buffer.alloc(1);
    while (fs.readSync(fd, buf, 0, 1, null) === 1) {
      if (buf[0] === 10 || buf[0] === 13) break;
      chunks.push(Buffer.from(buf));
    }
    fs.closeSync(fd);
    process.stdout.write('\n');
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    try { execFileSync('stty', ['echo'], {stdio: ['ignore', 'ignore', 'ignore']}); } catch {}
  }
}

let password = process.env.BLOG_STAGE_PASSWORD || process.env.MISSION_CONTROL_PASSWORD || '';
if (!password && args.fromUnlockedDashboard !== 'false') password = await passwordFromUnlockedDashboard();
if (!password && args.prompt !== 'false') password = passwordFromPrompt();
if (!password) {
  throw new Error('No staging password available. Unlock Mission Control in Chrome or run this from a TTY and enter the password prompt.');
}

const src = path.resolve(root,args.file);
const markdown = fs.readFileSync(src,'utf8');
const slug = String(args.slug || args.title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90);
const date = args.date || new Date().toISOString().slice(0,10);
const urlBase = args.urlBase || 'https://realjayai.github.io/mission-control/blog/';
const link = `${urlBase}#${slug}`;
const postsDir = path.join(root,'blog','posts');
fs.mkdirSync(postsDir,{recursive:true});

function enc(obj){
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password,salt,310000,32,'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm',key,iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj),'utf8'),cipher.final()]);
  const tag = cipher.getAuthTag();
  return {v:1,kdf:'PBKDF2-SHA256',iterations:310000,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:tag.toString('base64'),data:data.toString('base64'),updatedAt:new Date().toISOString()};
}

function dec(payload){
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const key = crypto.pbkdf2Sync(password,salt,payload.iterations || 310000,32,'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

const post = {title:args.title,summary:args.summary||'',source:args.source||'Five One Nine',date,status:args.status||'staged',markdown};
fs.writeFileSync(path.join(postsDir,`${slug}.enc.json`),JSON.stringify(enc(post),null,2));

let manifest={posts:[]};
const manifestPath=path.join(postsDir,'index.enc.json');
if (fs.existsSync(manifestPath)) {
  try { manifest = dec(JSON.parse(fs.readFileSync(manifestPath,'utf8'))); }
  catch { console.warn('Could not decrypt existing manifest. Rebuilding from local cache if available.'); }
}
const cachePath=path.join(root,'.blog-posts-cache.json');
if ((!manifest.posts || !manifest.posts.length) && fs.existsSync(cachePath)) manifest=JSON.parse(fs.readFileSync(cachePath,'utf8'));
manifest.posts = (manifest.posts||[]).filter(p=>p.slug!==slug);
manifest.posts.unshift({slug,title:args.title,summary:args.summary||'',date,source:args.source||'Five One Nine',link});
fs.writeFileSync(cachePath,JSON.stringify(manifest,null,2));
fs.writeFileSync(manifestPath,JSON.stringify(enc(manifest),null,2));

const emailDir=path.join(root,'blog-email-drafts');
fs.mkdirSync(emailDir,{recursive:true});
const subject=`Blog draft staged: ${args.title}`;
const body=`Caleb,\n\nI staged a new Five One Nine blog draft for review.\n\nTitle: ${args.title}\nSummary: ${args.summary||'Ready for review.'}\nLink: ${link}\n\nUse the same password as Mission Control.\n\nJay`;
fs.writeFileSync(path.join(emailDir,`${slug}.email.txt`),`Subject: ${subject}\n\n${body}\n`);
console.log(JSON.stringify({slug,link,emailDraft:path.join(emailDir,`${slug}.email.txt`)},null,2));
