// Fuzz test: the Perl number semantics emulated in web/dakster.js (string->number conversion,
// integer/float addition, comparison, division, %.15g stringification, %.1f) against real perl.
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const D = require(path.join(__dirname, '..', 'web', 'dakster.js'));
const P = D._perl;

function rnd(n) { return Math.floor(Math.random() * n); }
const pieces = ['0', '1', '2', '5', '9', '12', '78.6', '.', '.5', 'e', 'E', '+', '-', ' ', '\t', '%', 'x', 'a', 'inf',
  'nan', '0x1F', '1e3', '1e-5', '12345678901234567', '9007199254740993', '0.1', '0.2', '3.0', '00', '_', 'abc'];
function randStr() {
  const k = rnd(4);
  if (k === 0) return (Math.random() * Math.pow(10, rnd(20) - 8)).toPrecision(1 + rnd(17));
  if (k === 1) return String(rnd(100000) - 50000) + (rnd(3) ? '' : '.' + rnd(1000));
  let s = '';
  const n = 1 + rnd(4);
  for (let i = 0; i < n; i++) s += pieces[rnd(pieces.length)];
  return s;
}
const hex = (s) => Buffer.from(s, 'latin1').toString('hex');

function main(N) {
  const cases = [];
  for (let i = 0; i < N; i++) cases.push([randStr(), randStr()]);
  // a few fixed sums known to expose float formatting / integer paths
  cases.push(['0.1', '0.2'], ['1393.9', '800.99'], ['1e15', '0'], ['9007199254740993', '1'], ['-0.0', '0'],
    ['18446744073709551615', '1'], ['1000000000000005', '0.0'], ['12.50', ''], ['1.4%', '22.7%']);
  const input = cases.map(([a, b]) => hex(a) + ' ' + hex(b)).join('\n') + '\n';
  const perl = `no warnings; while (<STDIN>) { chomp; my ($a,$b) = map { pack("H*",$_) } split / /, $_, -1;
    $a = "" unless defined $a; $b = "" unless defined $b;
    # every operation gets fresh string copies, so no numeric value cached by an earlier op is reused
    my $n = "$a" + 0; my $s = "$a" + "$b"; my $g = ("$a" > "$b") ? 1 : 0;
    my $d = ("$b" + 0 != 0) ? "$a" / "$b" : "DIV0";
    my $f = sprintf("%.1f", ("$a" + 0.0) * 1.5); my $s3 = ("$a" + "$b") + "$b"; my $t = ($s) ? 1 : 0;
    print join("\\x01", $n, $s, $g, $d, $f, $t, $s3), "\\n"; }`;
  const out = execFileSync('perl', ['-e', perl], { input, encoding: 'latin1', maxBuffer: 1 << 28 }).split('\n');
  let fail = 0;
  cases.forEach(([a, b], i) => {
    const sum = P.add(a, b);
    const bz = P.num(b).n === 0;
    const js = [P.str(P.add(a, undefined)), P.str(sum), P.gt(a, b) ? 1 : 0, bz ? 'DIV0' : P.str(P.div(a, b)),
      P.fmtF(P.add(a, '0.0').n * 1.5, 1), P.truthy(sum) ? 1 : 0, P.str(P.add(sum, b))].join('\x01');
    if (js !== out[i]) {
      if (fail++ < 15) console.log('MISMATCH', JSON.stringify([a, b]), '\n  perl:', JSON.stringify(out[i]), '\n  js:  ', JSON.stringify(js));
    }
  });
  console.log(`perlnum: ${cases.length} cases, ${fail} mismatches`);
  return fail === 0;
}

if (require.main === module) process.exit(main(+(process.argv[2] || 20000)) ? 0 : 1);
module.exports = main;
