#!/usr/bin/env node
// Regression test: runs the legacy Perl CGI (legacy/dakster4a4.cgi) and the JavaScript port
// (web/dakster.js, the exact file the web page loads) on the same inputs, for every option
// combination, and compares every output file byte for byte.
//
//   node test/run.js            # everything
//   node test/run.js -j 4       # limit parallel perl processes
//   node test/run.js --quick    # fewer bin size/slope combinations
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CGI = path.join(ROOT, 'legacy', 'dakster4a4.cgi');
const Dakster = require(path.join(ROOT, 'web', 'dakster.js'));

const args = process.argv.slice(2);
const JOBS = args.includes('-j') ? +args[args.indexOf('-j') + 1] : Math.max(2, Math.min(16, os.cpus().length));
const QUICK = args.includes('--quick');

/* ---------- inputs and option grid ---------- */
const MODES = ['concatenate', 'add', 'keeplarge'];           // the three <option>s of the form
const BINSIZES = QUICK ? ['2', '0.5', '0'] : ['2', '1', '0.5', '5', '0', '-2', '', 'abc'];
const BINSLOPES = QUICK ? ['0', '0.01'] : ['0', '0.01', '0.1', '-0.01', ''];

function readBin(p) { return fs.readFileSync(p).toString('latin1'); }
const inputs = [];
const ex1 = readBin(path.join(ROOT, 'legacy', 'ex1.txt'));
inputs.push({ name: 'legacy/ex1.txt', text: ex1 });
inputs.push({ name: 'ex1 without leading blank line (DAx header detection)', text: ex1.replace(/^\n/, '') });
for (const f of fs.readdirSync(path.join(__dirname, 'inputs')).sort()) {
  inputs.push({ name: 'test/inputs/' + f, text: readBin(path.join(__dirname, 'inputs', f)) });
}
// sample names that are regular-expression metacharacters: documented divergence, tested separately
const DIVERGENT = new Set(['test/inputs/primer_regexnames.txt']);

const cases = [];
for (const inp of inputs) {
  const primer = /primerE/.test(inp.text.replace(/\r\n|\r/g, '\n').split('\n')[0] || '');
  const sizes = primer ? ['2'] : BINSIZES;
  const slopes = primer ? ['0'] : BINSLOPES;
  for (const binsize of sizes) for (const binslope of slopes) for (const multiplepeaks of MODES) {
    cases.push({ inp, opts: { binsize, binslope, multiplepeaks }, divergent: DIVERGENT.has(inp.name) });
  }
}

/* ---------- running the legacy CGI ---------- */
// A browser submits the textarea with CRLF line breaks, url-encoded (application/x-www-form-urlencoded).
function urlencode(bin) {
  let o = '';
  for (let i = 0; i < bin.length; i++) {
    const c = bin.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 46 || c === 95 || c === 42) o += bin[i];
    else if (c === 32) o += '+';
    else o += '%' + (c < 16 ? '0' : '') + c.toString(16).toUpperCase();
  }
  return o;
}
function formBody(text, opts) {
  const crlf = text.replace(/\r\n|\r|\n/g, '\r\n');
  return 'globalsheet=' + urlencode(crlf) + '&binsize=' + urlencode(opts.binsize) + '&binslope=' + urlencode(opts.binslope) +
    '&multiplepeaks=' + urlencode(opts.multiplepeaks) + '&form_done=Submit+Form';
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dakster-test-'));

function runLegacy(c, idx) {
  return new Promise((resolve) => {
    const dir = path.join(TMP, String(idx));
    fs.mkdirSync(path.join(dir, 'RESULTS'), { recursive: true });
    const body = Buffer.from(formBody(c.inp.text, c.opts), 'latin1');
    const p = spawn('perl', [CGI], {
      cwd: dir,
      env: { PATH: process.env.PATH, REQUEST_METHOD: 'POST', CONTENT_TYPE: 'application/x-www-form-urlencoded', CONTENT_LENGTH: String(body.length) },
    });
    const out = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', () => {});
    p.on('close', (code) => {
      const html = Buffer.concat(out).toString('latin1');
      const files = new Map();
      const res = path.join(dir, 'RESULTS');
      const sub = fs.readdirSync(res);
      for (const d of sub) for (const f of fs.readdirSync(path.join(res, d)).sort()) files.set(f, readBin(path.join(res, d, f)));
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, html, files, ndirs: sub.length });
    });
    p.stdin.end(body);
  });
}

/* ---------- comparison ---------- */
// primer.csv: the CGI lists the samples of each peak in Perl hash order, which is random per run.
// Sort lines within each group of equal peaks (column 2) so the comparison is order-independent there.
function canonPrimer(s) {
  const lines = s.split('\n');
  const head = lines.shift();
  const out = [];
  let group = [], cur = null;
  const flush = () => { out.push(...group.sort()); group = []; };
  for (const l of lines) {
    const pk = l.split('\t')[1];
    if (pk !== cur) { flush(); cur = pk; }
    group.push(l);
  }
  flush();
  return [head, ...out].join('\n');
}
function legacyBinsLog(html) {
  const i = html.indexOf('binning the peaks<br>\n');
  if (i < 0) return [];
  const rest = html.slice(i + 'binning the peaks<br>\n'.length);
  const j = rest.indexOf('<br><a');
  return rest.slice(0, j < 0 ? rest.length : j).split('<br>').filter((x) => x !== '');
}
// for the divergence case: blank the cells of samples whose names do not match themselves as a Perl regex
function blankRegexColumns(content) {
  const lines = content.split('\n');
  const head = lines[0].split('\t');
  const bad = head.map((n, i) => i > 0 && !new RegExp('^' + n + '$').test(n));
  return lines.map((l, k) => (k === 0 || l === '') ? l : l.split('\t').map((c, i) => (bad[i] ? '' : c)).join('\t')).join('\n');
}

function compare(c, legacy) {
  const errs = [];
  if (legacy.code !== 0 || /Software error|<h1>/.test(legacy.html)) errs.push('legacy CGI failed: ' + legacy.html.slice(0, 300));
  if (legacy.ndirs !== 1) errs.push('legacy wrote ' + legacy.ndirs + ' result folders');
  let js;
  try { js = Dakster.run(c.inp.text, c.opts); } catch (e) { errs.push('JS threw: ' + e.stack); return errs; }
  const jsFiles = new Map(js.files.map((f) => [f.name, f.content]));
  const ln = [...legacy.files.keys()].sort(), jn = [...jsFiles.keys()].sort();
  if (ln.join('|') !== jn.join('|')) errs.push('file sets differ\n   legacy: ' + ln.join(' ') + '\n   js:     ' + jn.join(' '));
  for (const name of ln) {
    if (!jsFiles.has(name)) continue;
    let a = legacy.files.get(name), b = jsFiles.get(name);
    if (name === 'primer.csv') { a = canonPrimer(a); b = canonPrimer(b); }
    if (c.divergent) b = blankRegexColumns(b);
    if (a !== b) {
      let k = 0;
      while (k < a.length && a[k] === b[k]) k++;
      errs.push(`${name} differs at byte ${k}\n   legacy: ${JSON.stringify(a.slice(Math.max(0, k - 40), k + 60))}\n   js:     ${JSON.stringify(b.slice(Math.max(0, k - 40), k + 60))}`);
    }
  }
  const lb = legacyBinsLog(legacy.html).join('|'), jb = js.binsLog.join('|');
  if (lb !== jb) errs.push('bin list on results page differs\n   legacy: ' + lb + '\n   js:     ' + jb);
  if (c.divergent) {
    // make sure the divergence is real (legacy dropped values) so the test documents something
    const dropped = [...legacy.files].some(([n, s]) => jsFiles.has(n) && s !== jsFiles.get(n));
    if (!dropped) errs.push('expected the legacy CGI to drop values for regex-like sample names, but it did not');
  }
  return errs;
}

/* ---------- other checks ---------- */
function zipCheck() {
  // the page's zip must be readable by a standard unzip and contain the exact file bytes
  const { execFileSync } = require('child_process');
  const r = Dakster.run(ex1, { binsize: '2', binslope: '0', multiplepeaks: 'concatenate' });
  const folder = 'output_dakster2026115-93-7/';
  const entries = [{ name: folder, data: new Uint8Array(0) }].concat(r.files.map((f) => ({ name: folder + f.name, data: Dakster.binToBytes(f.content) })));
  const zp = path.join(TMP, 'check.zip');
  fs.writeFileSync(zp, Dakster.makeZip(entries, new Date(2026, 0, 15, 9, 3, 7)));
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch (e) { console.log('zip: unzip not installed, skipped'); return true; }
  execFileSync('unzip', ['-tq', zp], { stdio: 'ignore' });
  const ex = path.join(TMP, 'unz');
  execFileSync('unzip', ['-q', zp, '-d', ex]);
  for (const f of r.files) {
    if (readBin(path.join(ex, folder, f.name)) !== f.content) { console.log('zip: content mismatch in ' + f.name); return false; }
  }
  console.log(`zip: ${r.files.length} files round-trip through unzip OK`);
  return true;
}

async function main() {
  console.log(`dakster regression: ${cases.length} runs (${inputs.length} inputs), ${JOBS} parallel perl processes`);
  let next = 0, fails = 0, done = 0;
  const failures = [];
  async function worker() {
    while (next < cases.length) {
      const idx = next++;
      const c = cases[idx];
      const legacy = await runLegacy(c, idx);
      const errs = compare(c, legacy);
      done++;
      if (errs.length) {
        fails++;
        failures.push(`FAIL ${c.inp.name} ${JSON.stringify(c.opts)}\n  ` + errs.join('\n  '));
      }
      if (done % 100 === 0) process.stderr.write(`  ${done}/${cases.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker));
  failures.slice(0, 20).forEach((f) => console.log(f));
  const perInput = {};
  cases.forEach((c) => { perInput[c.inp.name] = (perInput[c.inp.name] || 0) + 1; });
  for (const [k, v] of Object.entries(perInput)) console.log(`  ${String(v).padStart(4)}  ${k}${DIVERGENT.has(k) ? '  (documented divergence: regex-like sample names)' : ''}`);
  console.log(`regression: ${cases.length - fails}/${cases.length} runs identical` + (fails ? `, ${fails} FAILED` : ''));
  const zok = zipCheck();
  const nok = require('./perlnum')(QUICK ? 5000 : 50000);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fails === 0 && zok && nok ? 0 : 1);
}
main();
