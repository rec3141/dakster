/*
 * dakster.js - Dakster 5.0: client-side port of dakster4a4.cgi (Dakster fragment binner, v4.4, 2008).
 *
 * This file has no DOM dependencies: the web page (index.html) and the node regression
 * test (test/run.js) both load exactly this code.
 *
 * Strings handled here are "binary strings": one JS char per input byte (latin1), so that
 * sorting, splitting and output are byte-for-byte what the Perl CGI did.
 *
 * The Perl original relied on a number of Perl-specific behaviours that affect the output
 * files, and they are reproduced deliberately:
 *   - numeric conversion of strings ("1.4%" -> 1.4, "" -> 0), integer vs floating-point
 *     arithmetic, and number-to-string conversion (%.15g, e.g. 0.1+0.2 -> "0.3");
 *   - Perl truthiness when writing cells: values "" and "0" are written as empty cells;
 *   - split() dropping trailing empty fields;
 *   - autovivification side effects on which samples/peaks are listed.
 * See README.md for the full list, and for the places where this port intentionally differs.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Dakster = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Perl scalar emulation
   *   undefined          -> Perl undef
   *   JS string          -> Perl string (never yet used as a number)
   *   PNum {i, n}        -> Perl number; i is a BigInt when it is an integer (IV/UV), else null (NV)
   * ------------------------------------------------------------------ */
  function PNum(i, n) { this.i = i; this.n = n; }
  function mkIV(b) { return new PNum(b, Number(b)); }
  function mkNV(n) { return new PNum(null, n); }

  var IV_MIN = -(BigInt(2) ** BigInt(63));
  var UV_MAX = BigInt(2) ** BigInt(64) - BigInt(1);
  var TWO53 = Math.pow(2, 53); // results of float maths are only integers below 2**53

  function isWS(c) { // Perl \s / C isspace for bytes (no locale)
    return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  }

  // C strtod() as used by Perl 5.30's my_atof3 (accepts leading space, sign, inf/nan, hex, decimal).
  function strtod(s, p) {
    var L = s.length;
    while (p < L && isWS(s[p])) p++;
    var neg = false;
    if (s[p] === '+' || s[p] === '-') { neg = s[p] === '-'; p++; }
    var rest = s.slice(p);
    var v = null, m;
    if (/^inf/i.test(rest)) v = Infinity;
    else if (/^nan/i.test(rest)) v = NaN;
    else if ((m = /^0[xX](?:([0-9a-fA-F]+)(?:\.([0-9a-fA-F]*))?|\.([0-9a-fA-F]+))(?:[pP]([+-]?\d+))?/.exec(rest))) {
      var ip = m[1] || '', fp = (m[2] !== undefined ? m[2] : m[3]) || '';
      var M = BigInt('0x' + (ip + fp || '0'));
      var E = (m[4] ? parseInt(m[4], 10) : 0) - 4 * fp.length;
      v = Number(M);
      while (E > 0 && isFinite(v) && v !== 0) { var st = Math.min(E, 1000); v *= Math.pow(2, st); E -= st; }
      while (E < 0 && v !== 0) { var st2 = Math.min(-E, 1000); v /= Math.pow(2, st2); E += st2; }
    } else if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) {
      v = Number(m[0]);
    }
    if (v === null) return null;
    return neg ? -v : v;
  }

  // Perl's string -> NV conversion (my_atof3).
  function atof(s) {
    var p = 0, L = s.length;
    while (p < L && isWS(s[p])) p++;
    var neg = false;
    if (s[p] === '-') { neg = true; p++; } else if (s[p] === '+') p++;
    var rest = s.slice(p), v, m;
    if ((m = /^1\.#(INF|IND|QNAN|SNAN)/i.exec(rest))) v = m[1].toUpperCase() === 'INF' ? Infinity : NaN;
    else if (/^[qs]nan/i.test(rest)) v = NaN;
    else v = strtod(s, p);
    if (v === null) return 0;
    return neg ? -v : v;
  }

  var CLEAN_INT = /^[ \t\n\r\f\v]*([+-]?)(\d+)[ \t\n\r\f\v]*$/;
  var LOOKS_NUM = /^[ \t\n\r\f\v]*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[ \t\n\r\f\v]*$/;

  // Numeric value of a scalar as Perl's arithmetic ops see it (integer if it can be one).
  function num(x) {
    if (x === undefined || x === null) return mkIV(BigInt(0));
    if (x instanceof PNum) {
      if (x.i !== null) return x;
      if (Number.isInteger(x.n) && Math.abs(x.n) < TWO53) return mkIV(BigInt(x.n));
      return x;
    }
    var m = CLEAN_INT.exec(x);
    if (m) {
      var b = BigInt(m[2]);
      if (m[1] === '-') b = -b;
      if (b >= IV_MIN && b <= UV_MAX) return mkIV(b);
      return mkNV(Number(m[1] + m[2]));
    }
    var d = atof(x);
    // Only strings that look like a number (Perl's grok_number) can take the integer path, and
    // "123.0"-style strings (decimal point, no exponent) stay floating point, as in perl 5.30.
    if (/^[ \t\n\r\f\v]*-[ \t\n\r\f\v]+$/.test(x)) return mkIV(BigInt(0)); // perl 5.30 quirk
    if (LOOKS_NUM.test(x) && !/^[ \t\n\r\f\v]*[+-]?\d*\.\d*[ \t\n\r\f\v]*$/.test(x) && Number.isInteger(d)) {
      var bi = BigInt(d);
      if (bi >= IV_MIN && bi <= UV_MAX) return mkIV(bi);
    }
    return mkNV(d);
  }
  function dbl(x) { return num(x).n; }

  function add(a, b) {
    var A = num(a), B = num(b);
    if (A.i !== null && B.i !== null) {
      var r = A.i + B.i;
      if (r >= IV_MIN && r <= UV_MAX) return mkIV(r);
    }
    return mkNV(A.n + B.n);
  }
  function div(a, b) {
    var A = num(a), B = num(b);
    if (B.n === 0) throw new Error('Illegal division by zero');
    if (A.i !== null && B.i !== null && A.i % B.i === BigInt(0)) {
      var r = A.i / B.i;
      if (r >= IV_MIN && r <= UV_MAX) return mkIV(r);
    }
    return mkNV(A.n / B.n);
  }
  function gt(a, b) {
    var A = num(a), B = num(b);
    if (A.i !== null && B.i !== null) return A.i > B.i;
    return A.n > B.n;
  }
  function pabs(x) {
    var A = num(x);
    if (A.i !== null) return mkIV(A.i < 0 ? -A.i : A.i);
    return mkNV(Math.abs(A.n));
  }
  function truthy(x) {
    if (x === undefined || x === null) return false;
    if (x instanceof PNum) return x.i !== null ? x.i !== BigInt(0) : x.n !== 0;
    return x !== '' && x !== '0';
  }
  function str(x) {
    if (x === undefined || x === null) return '';
    if (x instanceof PNum) return x.i !== null ? x.i.toString() : fmtG(x.n, 15);
    return x;
  }

  /* ---- exact double formatting (glibc printf semantics: exact value, round-half-even) ---- */
  function exactDecimal(x) { // x finite, > 0. returns {D, e10}: x == D * 10^e10 exactly
    var dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, x);
    var hi = dv.getUint32(0), lo = dv.getUint32(4);
    var bexp = (hi >>> 20) & 0x7ff;
    var mant = (BigInt(hi & 0xfffff) << BigInt(32)) | BigInt(lo);
    if (bexp === 0) bexp = 1; else mant |= BigInt(1) << BigInt(52);
    var e2 = bexp - 1075;
    if (e2 >= 0) return { D: (mant << BigInt(e2)).toString(), e10: 0 };
    return { D: (mant * BigInt(5) ** BigInt(-e2)).toString(), e10: e2 };
  }
  function roundDigits(D, keep) { // keep >= 0 leading digits of D, half-even; returns string (may grow by 1)
    if (D.length <= keep) return D;
    var head = D.slice(0, keep), rest = D.slice(keep);
    var up;
    if (rest[0] > '5') up = true;
    else if (rest[0] < '5') up = false;
    else if (/[1-9]/.test(rest.slice(1))) up = true;
    else up = head.length > 0 && (parseInt(head[head.length - 1], 10) % 2 === 1);
    if (!up) return head === '' ? '0' : head;
    return (BigInt(head === '' ? '0' : head) + BigInt(1)).toString();
  }
  function fmtG(x, P) { // Perl's "%.15g" number stringification
    if (isNaN(x)) return 'NaN';
    if (x === Infinity) return 'Inf';
    if (x === -Infinity) return '-Inf';
    if (x === 0) return '0';
    var sign = x < 0 ? '-' : '';
    var ed = exactDecimal(Math.abs(x));
    var D = ed.D.replace(/^0+/, '');
    var X = D.length - 1 + ed.e10;
    var R = roundDigits(D, P);
    if (R.length > P) { X += 1; R = R.slice(0, P); }
    while (R.length < P) R += '0';
    var out;
    function trim0(t) { return t.indexOf('.') < 0 ? t : t.replace(/0+$/, '').replace(/\.$/, ''); }
    if (X < -4 || X >= P) {
      var mant = trim0(R[0] + '.' + R.slice(1));
      var ex = Math.abs(X).toString();
      if (ex.length < 2) ex = '0' + ex;
      out = mant + 'e' + (X < 0 ? '-' : '+') + ex;
    } else if (X < 0) {
      out = trim0('0.' + '0'.repeat(-X - 1) + R);
    } else {
      out = trim0(R.slice(0, X + 1) + '.' + R.slice(X + 1));
    }
    return sign + out;
  }
  function fmtF(x, f) { // sprintf("%.<f>f")
    if (isNaN(x)) return 'NaN';
    if (!isFinite(x)) return x > 0 ? 'Inf' : '-Inf';
    var sign = (x < 0 || Object.is(x, -0)) ? '-' : '';
    var N;
    if (x === 0) N = '0';
    else {
      var ed = exactDecimal(Math.abs(x));
      var sh = ed.e10 + f;
      if (sh >= 0) N = ed.D + '0'.repeat(sh);
      else {
        var cut = -sh, D = ed.D;
        if (D.length < cut) D = '0'.repeat(cut - D.length) + D;
        N = roundDigits(D, D.length - cut);
      }
    }
    while (N.length <= f) N = '0' + N;
    return sign + (f > 0 ? N.slice(0, N.length - f) + '.' + N.slice(N.length - f) : N);
  }

  /* ---- misc Perl helpers ---- */
  function psplit(s, ch) { // split /ch/, $s  (trailing empty fields removed)
    if (s === '') return [];
    var a = s.split(ch);
    while (a.length && a[a.length - 1] === '') a.pop();
    return a;
  }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }       // sort { $a cmp $b }
  function cmpNum(a, b) {                                               // sort { $a <=> $b }
    var x = dbl(a), y = dbl(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function sortedStr(arr) { return arr.slice().sort(cmpStr); }
  function sortedNum(arr) { return arr.slice().sort(cmpNum); }          // stable, like Perl's mergesort
  function cleanName(s) { return s.replace(/[% \t\n\r\f\v().\\\/']+/g, ''); } // s/[\%\s\(\)\.\\\/']+//g
  function viv(map, key) { // $map{$key} autovivified as a hash
    var v = map.get(key);
    if (v === undefined) { v = new Map(); map.set(key, v); }
    return v;
  }
  function key(x) { return x === undefined ? '' : x; } // undef used as a hash key

  /* ------------------------------------------------------------------ *
   * DAx / tab-delimited path (readDaxFile, binSub, daxPrintSub, transposeSub)
   * ------------------------------------------------------------------ */
  function readDaxFile(lines, st, log) {
    log.push('reading file');
    var colnames = [];
    var Samples = [];
    var hash = new Map(); // bp -> sample -> column -> value
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (/^[^ \t\n\r\f\v]*$/.test(line)) continue;
      if (/Peak/i.test(line)) {
        colnames = psplit(line, '\t');
        colnames.shift();
        colnames.shift();
        colnames = colnames.map(cleanName);
        continue;
      } else if (line.indexOf(':') >= 0) {
        if (/noise/i.test(line)) continue;
        if (line.indexOf('\t') >= 0) {
          var Cols = psplit(line, '\t').map(function (c) { return c.replace(/[\r\n]/, '').replace(/:.+/, ''); });
          Samples.push(Cols[0]);
          for (var i = 0; i < colnames.length; i++) {
            viv(viv(hash, key(Cols[1])), key(Cols[0])).set(colnames[i], Cols[i + 2]);
          }
        }
      }
    }
    var saw = new Set();
    st.uSamples = Samples.filter(function (s) { s = key(s); if (saw.has(s)) return false; saw.add(s); return true; }).map(key);
    st.uBases = Array.from(hash.keys());
    st.colnames = colnames;
    return hash;
  }

  function binSub(st, opts, log) {
    var peakHash = st.peakHash, mp = opts.multiplepeaks;
    var binsize = st.binsize, binslope = st.binslope;
    var bsz = binsize.n, bsl = binslope.n;
    var binHash = new Map();
    log.push('Your multiple peaks method is ' + str(mp));
    if (bsl > 0) {
      log.push('The starting point of your bins (bp), and their widths (using the equation  y = ' +
        str(binslope) + ' * x + ' + str(binsize) + ' ) are as follows:');
      log.push('bp,width');
    } else log.push('Your bin width is ' + str(binsize) + ' bp.');
    log.push('binning the peaks');
    var c0 = key(st.colnames[0]);
    var samples = sortedStr(st.uSamples);
    var bases = sortedNum(st.uBases);
    var xcount = 0, tempbin, keyschecked = 0;
    for (var idx = 0; idx < bases.length;) {
      var k1 = bases[idx];
      var k1n = dbl(k1);
      var ybin = bsz + bsl * k1n;
      var rybin = fmtF(ybin, 1);
      if (xcount === 0) tempbin = k1;
      // legacy: ((keyschecked++) && print ...) never prints, it only increments
      if (keyschecked === 0 && bsl > 0) keyschecked++;
      if (Math.abs(k1n - dbl(tempbin)) < ybin || xcount === 0) {
        xcount++;
        for (var s = 0; s < samples.length; s++) {
          var key2 = samples[s];
          var v = viv(viv(peakHash, k1), key2).get(c0);
          var bh = viv(binHash, tempbin);
          if (v !== undefined) {
            var cur = bh.get(key2);
            if (cur !== undefined) {
              if (mp === 'add') bh.set(key2, add(cur, v));
              else if (mp === 'keeplarge') { if (gt(v, cur)) bh.set(key2, v); }
              else if (mp === 'concatenate') bh.set(key2, str(cur) + '+' + v);
            } else bh.set(key2, v);
          } else if (!bh.has(key2)) bh.set(key2, v);
        }
        idx++;
      } else {
        tempbin = k1;
        xcount = 0;
        if (bsl > 0) { log.push(tempbin + ',' + rybin); st.binsLog.push(tempbin + ',' + rybin); }
        // redo KEY: same k1 again
      }
    }
    return binHash;
  }

  function transposeSub(content) {
    var lines = content.split('\n');
    if (content === '') lines = [];
    else if (content[content.length - 1] === '\n') lines.pop();
    var R = [], i = 0, icount = 0, jcount, line = [];
    for (var li = 0; li < lines.length; li++) {
      line = psplit(lines[li], '\t');
      jcount = 0;
      for (var j = 1; j <= line.length - 1; j++) {
        (R[i] = R[i] || [])[j] = line[j];
        jcount++;
      }
      i++;
      icount++;
    }
    icount--;
    var nlin = i - 1, ncol = line.length - 1;
    var out = (jcount === undefined ? '' : jcount) + ' ' + icount + ' 1';
    for (var a = 0; a <= ncol; a++) {
      for (var b = 0; b <= nlin; b++) {
        out += str(R[b] && R[b][a]);
        if (b === 0) out += '\t';
      }
      out += '\n';
    }
    return out;
  }

  function daxPrintSub(st, files) {
    var peakHash = st.peakHash, binHash = st.binHash, colnames = st.colnames;
    var peaklist = sortedNum(Array.from(peakHash.keys()));
    var binlist = sortedNum(Array.from(binHash.keys()));
    var topstrings = '\t';
    var first = viv(peakHash, key(peaklist[0]));
    sortedStr(Array.from(first.keys())).forEach(function (k2) { topstrings += k2 + '\t'; });
    var newcolnames = colnames.concat(['binned', 'presence', 'distance']);
    var c0 = key(colnames[0]);

    // primer.csv
    var out = 'ID\tpeak\t\tsample\t' + colnames.join('\t') + '\n';
    sortedNum(Array.from(peakHash.keys())).forEach(function (peak) {
      var ph = peakHash.get(peak);
      // legacy iterates a Perl hash here (random order); we use sorted sample order
      sortedStr(Array.from(ph.keys())).forEach(function (sample) {
        var sh = ph.get(sample);
        if (sh.get(c0) === undefined) return;
        out += sample + '-' + peak + '\t' + peak + '\t\t' + sample + '\t' +
          colnames.map(function (c) { return str(sh.get(c)); }).join('\t') + '\n';
      });
    });
    files.set('primer.csv', out);

    var samples = sortedStr(st.uSamples);
    newcolnames.forEach(function (k3) {
      var o = topstrings;
      var binned = k3 === 'binned' || k3 === 'presence';
      var keylist = binned ? binlist : peaklist;
      keylist.forEach(function (k1) {
        o += '\n' + k1 + '\t';
        samples.forEach(function (k2) {
          var v;
          if (k3 === 'binned') {
            v = binHash.get(k1) && binHash.get(k1).get(k2);
            o += truthy(v) ? str(v) + '\t' : '\t';
          } else if (k3 === 'presence') {
            v = binHash.get(k1) && binHash.get(k1).get(k2);
            o += truthy(v) ? '1\t' : '0\t';
          } else {
            var a = peakHash.get(k1), b = a && a.get(k2);
            v = b && b.get(k3);
            o += truthy(v) ? str(v) + '\t' : '\t';
          }
        });
      });
      files.set(k3 + '.csv', o);
    });
    files.set('phylip.csv', transposeSub(files.get('presence.csv')));
  }

  /* ------------------------------------------------------------------ *
   * primerE path (readPrimerFile, primerPrintSub)
   * ------------------------------------------------------------------ */
  function readPrimerFile(lines, st) {
    var row = 0, hash = new Map();
    st.primercolnames = [];
    st.binindices = [];
    st.minbinindex = undefined;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (/^[ \t\n\r\f\v]*$/.test(line)) continue;
      row++;
      if (row === 2) {
        st.primercolnames = psplit(line, '\t').map(cleanName);
        for (var c = 0; c < st.primercolnames.length; c++) {
          if (/^bins/.test(st.primercolnames[c])) st.binindices.push(c);
        }
        st.minbinindex = (st.binindices.length ? st.binindices[0] : 0) - 1;
      } else if (row > 2) {
        var cols = psplit(line, '\t').map(function (x) { return x.replace(/[\r\n]/g, ''); });
        st.binindices.forEach(function (bi) {
          var arr = viv(viv(hash, key(st.primercolnames[bi])), key(cols[bi]));
          var rec = arr.get(key(cols[3]));
          if (!rec) { rec = []; arr.set(key(cols[3]), rec); }
          rec.push(cols[1]);
          for (var k = 4; k <= st.minbinindex; k++) rec.push(cols[k]);
        });
      }
    }
    return hash;
  }

  function primerPrintSub(st, opts, files, warnings) {
    var peakHash = st.peakHash, mp = opts.multiplepeaks, pc = st.primercolnames;
    var allsamples = [];
    var binsbp = pc.filter(function (n) { return /bins/.test(n); });
    var mbi = st.minbinindex === undefined ? 0 : st.minbinindex; // undef in 4..undef -> 4..0
    var traitnames = [pc[1]];
    for (var k = 4; k <= mbi; k++) traitnames.push(pc[k]);
    var numtraits = traitnames.length;
    var unsafe = {};

    for (var trait = 0; trait < numtraits; trait++) {
      binsbp.forEach(function (bingroup) {
        var fname = 'primer-' + bingroup + '-' + str(traitnames[trait]) + '.csv';
        var group = viv(peakHash, bingroup);
        var binnames = sortedStr(Array.from(group.keys()));
        binnames.forEach(function (bin) { allsamples = allsamples.concat(sortedStr(Array.from(group.get(bin).keys()))); });
        allsamples = sortedStr(Array.from(new Set(allsamples)));
        var out = '\t' + allsamples.join('\t') + '\n';
        var save = [];
        binnames.forEach(function (bin) {
          var bh = group.get(bin);
          var samples = sortedStr(Array.from(bh.keys()));
          var nsamp = mkIV(BigInt(0)), binsum = mkIV(BigInt(0));
          samples.forEach(function (sn) {
            var arr = bh.get(sn), m = arr.length / numtraits;
            nsamp = add(nsamp, mkNV(m));
            for (var q = 0; q < m; q++) binsum = add(binsum, arr[q <= 100 ? q * numtraits : 0]);
          });
          var line = str(div(binsum, nsamp)) + '\t';
          allsamples.forEach(function (name) {
            // legacy: grep(/^$allsamplename$/, @samples) -- a regex; we test exact membership
            if (/[\\^$.|?*+()[\]{}]/.test(name)) unsafe[name] = true;
            if (bh.has(name)) {
              var arr = bh.get(name), m = arr.length / numtraits, ta = [];
              for (var q = 0; q < m; q++) ta.push(arr[(q <= 100 ? q * numtraits : 0) + trait]);
              if (mp === 'add') {
                var sum;
                ta.forEach(function (v) { sum = add(sum, v); });
                line += str(sum) + '\t';
              } else if (mp === 'keeplarge') {
                var max = ta.pop();
                ta.forEach(function (v) { if (gt(v, max)) max = v; });
                line += str(max) + '\t';
              } else if (mp === 'concatenate') {
                line += ta.map(str).join('+') + '\t';
              }
            } else line += '\t';
          });
          save.push(line + '\n');
        });
        save.sort(cmpNum).forEach(function (l) { out += l; });
        files.set(fname, out);
      });
    }
    var names = Object.keys(unsafe);
    if (names.length) {
      warnings.push('Sample names containing regular-expression characters: ' + names.join(', ') +
        '. The 2008 CGI matched sample names as regular expressions in primerE mode, so with these names ' +
        'it could leave their cells empty or stop with an error; this version matches names exactly.');
    }
  }

  /* ------------------------------------------------------------------ *
   * entry point
   * ------------------------------------------------------------------ */
  // input: binary string (one char per byte). opts: {binsize, binslope, multiplepeaks} as form strings.
  function run(input, opts) {
    opts = opts || {};
    var log = [], warnings = [], files = new Map();
    var st = { binsLog: [] };
    var text = String(input).replace(/\r\n|\n|\r/g, '\n');
    for (var c = 0; c < 2; c++) if (text[text.length - 1] === '\n') text = text.slice(0, -1);
    var mp = opts.multiplepeaks;
    if (typeof mp === 'string' && mp[mp.length - 1] === '\n') mp = mp.slice(0, -1);
    var o = { multiplepeaks: mp };
    st.binslope = pabs(opts.binslope);
    st.binsize = pabs(opts.binsize);

    var lines = psplit(text, '\n');
    var filetype = 'tab';
    if (lines.length) {
      if (/primerE/.test(lines[0])) filetype = 'primer';
      else if (/DAx/.test(lines[0])) filetype = 'dax';
    }
    if (filetype === 'primer') {
      st.peakHash = readPrimerFile(lines, st);
      log.push('primer file found!');
      primerPrintSub(st, o, files, warnings);
    } else {
      st.peakHash = readDaxFile(lines, st, log);
      log.push(filetype === 'dax' ? 'dax file found!' : 'tab-delimited file found!');
      st.binHash = binSub(st, o, log);
      daxPrintSub(st, files);
    }
    return {
      filetype: filetype,
      files: Array.from(files, function (e) { return { name: e[0], content: e[1] }; }),
      log: log,
      binsLog: st.binsLog,
      warnings: warnings,
      colnames: st.colnames || [],
    };
  }

  // Name of the legacy results folder, e.g. output_dakster2026115-93-7 (no zero padding, as in 2008).
  function folderName(d) {
    d = d || new Date();
    return 'output_dakster' + d.getFullYear() + (d.getMonth() + 1) + d.getDate() + '-' +
      d.getHours() + d.getMinutes() + '-' + d.getSeconds();
  }

  /* ------------------------------------------------------------------ *
   * byte helpers and a minimal ZIP (stored, no compression) writer
   * ------------------------------------------------------------------ */
  function binToBytes(s) {
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }
  function bytesToBin(u) {
    var out = '', CH = 0x8000;
    for (var i = 0; i < u.length; i += CH) out += String.fromCharCode.apply(null, u.subarray(i, i + CH));
    return out;
  }
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u) {
    var c = 0xffffffff;
    for (var i = 0; i < u.length; i++) c = CRC_TABLE[(c ^ u[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function isUtf8NonAscii(u) {
    if (!/[^\x00-\x7f]/.test(bytesToBin(u))) return false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(u); return true; } catch (e) { return false; }
  }
  // entries: [{name: binary string, data: Uint8Array}] -> Uint8Array (.zip)
  function makeZip(entries, date) {
    date = date || new Date();
    var dtime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    var ddate = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    var chunks = [], central = [], offset = 0;
    function hdr(size) { var b = new Uint8Array(size); return { b: b, v: new DataView(b.buffer) }; }
    entries.forEach(function (e) {
      var name = binToBytes(e.name), data = e.data, crc = crc32(data);
      var flags = isUtf8NonAscii(name) ? 0x0800 : 0;
      var L = hdr(30);
      L.v.setUint32(0, 0x04034b50, true); L.v.setUint16(4, 10, true); L.v.setUint16(6, flags, true);
      L.v.setUint16(8, 0, true); L.v.setUint16(10, dtime, true); L.v.setUint16(12, ddate, true);
      L.v.setUint32(14, crc, true); L.v.setUint32(18, data.length, true); L.v.setUint32(22, data.length, true);
      L.v.setUint16(26, name.length, true); L.v.setUint16(28, 0, true);
      chunks.push(L.b, name, data);
      var C = hdr(46);
      C.v.setUint32(0, 0x02014b50, true); C.v.setUint16(4, 0x031e, true); C.v.setUint16(6, 10, true);
      C.v.setUint16(8, flags, true); C.v.setUint16(10, 0, true); C.v.setUint16(12, dtime, true);
      C.v.setUint16(14, ddate, true); C.v.setUint32(16, crc, true); C.v.setUint32(20, data.length, true);
      C.v.setUint32(24, data.length, true); C.v.setUint16(28, name.length, true);
      var isDir = name.length && name[name.length - 1] === 0x2f;
      C.v.setUint32(38, (isDir ? 0o40755 : 0o100644) * 65536, true);
      C.v.setUint32(42, offset, true);
      central.push(C.b, name);
      offset += 30 + name.length + data.length;
    });
    var csize = central.reduce(function (s, b) { return s + b.length; }, 0);
    var E = hdr(22);
    E.v.setUint32(0, 0x06054b50, true); E.v.setUint16(8, entries.length, true); E.v.setUint16(10, entries.length, true);
    E.v.setUint32(12, csize, true); E.v.setUint32(16, offset, true);
    var all = chunks.concat(central, [E.b]);
    var total = all.reduce(function (s, b) { return s + b.length; }, 0);
    var out = new Uint8Array(total), p = 0;
    all.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }

  return {
    run: run,
    folderName: folderName,
    makeZip: makeZip,
    binToBytes: binToBytes,
    bytesToBin: bytesToBin,
    crc32: crc32,
    // exposed for the regression tests
    _perl: { num: num, add: add, div: div, gt: gt, str: str, truthy: truthy, fmtG: fmtG, fmtF: fmtF, atof: atof, psplit: psplit },
  };
});
