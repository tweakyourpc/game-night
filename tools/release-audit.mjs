// Content inventory, not a claim of asset ownership. Unknown raster payloads fail closed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'tools/asset-policy.json')));
const allowed = new Set(Object.values(policy.allowedRaster));
export const hash = b => crypto.createHash('sha256').update(b).digest('hex');
export function auditBytes(name, b) {
  const digest = hash(b);
  if (policy.excludedSHA256[digest]) throw Error('Excluded image content in ' + name);
  const raster = b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (b[0] === 255 && b[1] === 216) || b.subarray(0,3).toString() === 'GIF' || b.subarray(8,12).toString() === 'WEBP';
  if (raster && !allowed.has(digest)) throw Error('Uninventoried raster content in ' + name);
  const text = b.toString('utf8');
  for (const m of text.matchAll(/(?:data:image\/[\w.+-]+;base64,|["'])([A-Za-z0-9+/]{100,}={0,2})/g)) {
    const payload = Buffer.from(m[1], 'base64');
    if (payload.length < b.length) auditBytes(name + ' (embedded)', payload);
  }
  if (/^(?:.*\/)?(?:scrabble_board|board_classic|crabbles_tiles|tiles_birch)(?:[./_-]|$)/i.test(name)) throw Error('Excluded asset filename: ' + name);
  if (/AKfycb[A-Za-z0-9_-]{25,}|AIza[\w-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ya29\.[\w.-]+/.test(text)) throw Error('Possible private binding/credential in ' + name);
  if (/https:\/\/script\.google\.com\/macros\/s\/(?!REPLACE)[A-Za-z0-9_-]{20,}|https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/.test(text)) throw Error('Real deployment or sheet link in ' + name);
}
export function auditTree(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    if (['.git','node_modules','dist','build','test','.codex','.agents','.aws'].includes(e.name)) continue;
    const p = path.join(dir,e.name);
    if(e.isSymbolicLink()) throw Error('Symlink in release input: '+p);
    if(e.isDirectory()) auditTree(p); else auditBytes(p, fs.readFileSync(p));
  }
}
export function verifyInventory() {
  for (const [p,digest] of Object.entries(policy.allowedRaster)) if(hash(fs.readFileSync(path.join(root,p))) !== digest) throw Error('Asset inventory changed: '+p);
  for (const [p,key] of [['tools/effectcraft/fonts/OFL','fontLicenseSHA256'],['tools/effectcraft/fonts/Cinzel.ttf','fontSHA256']]) if(hash(fs.readFileSync(path.join(root,p))) !== policy[key]) throw Error('Vendor bytes changed: '+p);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { verifyInventory(); auditTree(process.argv[2] || root); console.log('Release content audit passed'); }
