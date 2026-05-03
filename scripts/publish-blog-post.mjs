#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const args = Object.fromEntries(process.argv.slice(2).map((a,i,arr)=>a.startsWith('--')?[a.slice(2),arr[i+1]&& !arr[i+1].startsWith('--')?arr[i+1]:true]:[]).filter(Boolean));
const password = process.env.BLOG_STAGE_PASSWORD || process.env.MISSION_CONTROL_PASSWORD;
if (!password) throw new Error('Set BLOG_STAGE_PASSWORD to the same password used by Mission Control.');
if (!args.file || !args.title) throw new Error('Usage: BLOG_STAGE_PASSWORD=... node scripts/publish-blog-post.mjs --file draft.md --title "Title" --summary "Short summary"');
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

const post = {title:args.title,summary:args.summary||'',source:args.source||'Five One Nine',date,status:args.status||'staged',markdown};
fs.writeFileSync(path.join(postsDir,`${slug}.enc.json`),JSON.stringify(enc(post),null,2));
let manifest={posts:[]};
const manifestPath=path.join(postsDir,'index.enc.json');
if (fs.existsSync(manifestPath)) {
  console.warn('Existing encrypted index cannot be merged without decrypt support in this script run. Rebuilding from staged metadata cache.');
}
const cachePath=path.join(root,'.blog-posts-cache.json');
if (fs.existsSync(cachePath)) manifest=JSON.parse(fs.readFileSync(cachePath,'utf8'));
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
