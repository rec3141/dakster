# Dakster

Dakster is a program for binning and outputting fragment analysis data, e.g. from T-RFLP or ARISA.

It takes a DAx(R) output file or a tab-delimited spreadsheet with sample name, fragment length and
fragment height (or other parameters), and bins the heights (or other parameters) by fragment length
with a simple model: the first unbinned peak is the lower boundary of a bin, the bin size is added to
get the upper boundary, all peaks inside go into that bin, and the process repeats from the next
unbinned peak. The bin width can grow linearly with fragment length (bin slope). When one sample has
several peaks in a bin, Dakster concatenates them (`100+111`), adds them (`211`) or keeps the largest
(`111`). Version 4 can also read a primerE export in which peaks were clustered into bins (factors
named `bins...`) and write one binned table per bin factor and trait. The binning is deliberately
simple and is meant as a starting point for manual correction.

The full instructions are in [`legacy/dakster_manual.txt`](legacy/dakster_manual.txt), and are
reproduced on the web page.


## Versions

- **5.0** (November 2026): runs entirely in the browser (`web/`); nothing is uploaded or stored. Same inputs, options
  and output files as 4.4, byte for byte, except two documented changes below: `primer.csv` lists samples in a fixed
  (sorted) order, and primerE sample names containing regex characters are matched exactly instead of losing data.
- **4.4** (July 2008): the Perl CGI in `legacy/`.

## Repository layout

| Path | What it is |
|---|---|
| `web/index.html` | The browser version: one static page, no build step, no external requests. |
| `web/dakster.js` | All of the computation (and a small .zip writer). No DOM code, so node can load it too. |
| `test/run.js` | Regression test: legacy CGI vs `web/dakster.js`, every output file compared byte for byte. |
| `test/perlnum.js` | Fuzz test of the Perl number handling that `dakster.js` emulates, against real `perl`. |
| `test/inputs/` | Synthetic edge-case inputs used by the regression test. |
| `legacy/` | The original 2008 Perl CGI (`dakster4a4.cgi`), its form (`index.html`), the manual and the example input (`ex1.txt`), unchanged and kept for reference. |

## Using the web version

Open `web/index.html` in a browser (from a web server or straight from disk). Paste the DAx global
sheet, tab-delimited spreadsheet or primerE file into the box, or open the file with the file picker,
set the bin size, bin slope and multiple-peak rule, and click **Bin peaks**. Each output file can be
downloaded on its own, or all together as `output_dakster<date>-<time>.zip`.

Everything happens in the browser. The page makes no network requests and stores nothing. The
original CGI saved every submission in a public `RESULTS/` folder on the server.

The options are the same as on the original form: bin size (default 2), bin slope (default 0), and
concatenate / add / keep largest.

### Output files

The file names, column order, number formatting, line endings (`\n`) and lack of quoting are the
same as the CGI's. The files are tab-separated even though they are named `.csv`.

DAx or tab-delimited input:

| File | Contents |
|---|---|
| `primer.csv` | one row per peak (`ID`, `peak`, blank, `sample`, then every data column), to import into primerE |
| `<column>.csv` | one per data column after the fragment length (e.g. `Height.csv`, `AreaFract.csv`, `Widths.csv`): all fragment lengths × samples, not binned. Column names lose whitespace and `% ( ) . \ / '` |
| `binned.csv` | the third input column (usually height) binned: bin start × samples |
| `presence.csv` | presence/absence (1/0) of the binned peaks |
| `distance.csv` | an empty all-peaks × samples table (the distance-matrix code in the CGI was never enabled) |
| `phylip.csv` | `presence.csv` transposed, with a `<samples> <bins> 1` header, as a PHYLIP infile |

primerE input (first line contains `primerE`):

| File | Contents |
|---|---|
| `primer-<binfactor>-<trait>.csv` | one per bin factor column (name containing `bins`) and per trait (the `peak` column plus the columns before the first `bins` column, from the 5th on): average fragment length of the bin, then one value per sample |

## Running the tests

Requirements: `node` (18 or newer), `perl` with `CGI::Carp` (part of CGI.pm), and optionally `unzip`
(to check the generated zip).

```bash
node test/run.js            # full run: 1332 CGI runs, ~10 s on 16 cores
node test/run.js --quick    # 210 runs
node test/run.js -j 4       # limit parallel perl processes
node test/perlnum.js 100000 # only the number-handling fuzz test
```

`test/run.js` runs `legacy/dakster4a4.cgi` as a POST request (the textarea url-encoded with CRLF
line breaks, as a browser sends it) in a temporary directory, so its `./RESULTS/` folder is local and
deleted afterwards. It then runs `web/dakster.js` on the same input and compares the set of file names
and every file byte for byte, plus the list of bin starts and widths shown on the results page.

Inputs: `legacy/ex1.txt`, the same file without its leading blank line (DAx detection), and
everything in `test/inputs/`: the manual's minimal example, several peaks per bin with awkward values
(`0`, `0.1`+`0.2`, `12.50`, `1e3`, percentages, negative numbers, integers above 2^53, UTF-8 sample
names), overlapping sample names (`S1`, `S10`, `S1a`), peaks exactly on and near bin edges, two
size-standard ranges (50–500 and 400–1200 bp), CRLF line ends with blank, whitespace-only, tab-only,
noise, short and long rows, column names that collide with output files, empty input, input without
a header row, and four primerE files (two bin factors, a column containing but not starting with
`bins`, more than 101 peaks of one sample in one bin, sample names that are regex metacharacters).

Option grid for DAx/tab inputs: bin size `2 1 0.5 5 0 -2 (empty) abc` × bin slope
`0 0.01 0.1 -0.01 (empty)` × the three multiple-peak rules. primerE inputs: the three rules.

## Differences from the CGI

All tested runs give byte-identical files, apart from the following, which are handled in the test as
described.

1. **Row order inside `primer.csv`.** For each fragment length the CGI listed the samples in Perl hash
   order, which is random and changes from run to run. The port lists them sorted by sample name. The
   test sorts the rows of each fragment length before comparing.
2. **primerE input with sample names that contain regular-expression characters.** The CGI tested
   whether a sample was in a bin with `grep(/^$name$/, ...)`, so a sample name was used as a regex.
   Names such as `S(1)` or `S+2` do not match themselves, and the CGI left all of their cells empty.
   Names that are invalid regexes (`S(1`), or that also match another sample in a bin where they have
   no peak (`S.1` vs `SX1`), make the CGI stop with "Software error" after writing part of the first
   file. The port compares names exactly and shows a warning when such names occur. The test checks
   that the CGI's output equals the port's with those samples' cells blanked.
3. **Fragment lengths that are numerically equal but written differently** (e.g. `83` and `83.0` in
   the same file). They are separate rows, and the CGI ordered them randomly (hash order), which also
   decides which one starts a bin. The port keeps the order in which they first appear in the input.
   The test inputs avoid this case.
4. **Results folder.** The CGI wrote to `./RESULTS/output_dakster<Y><M><D>-<h><m>-<s>` (local time,
   no zero padding) on the server. The port stores nothing; the zip file and the folder inside it use
   the same name.
5. **Numbers of 2^53 and above.** Perl's arithmetic on such values depends on whether a string was
   already used as a number earlier in the run (Perl caches the conversion). The port follows the
   first-use behaviour. Real peak data never comes near this.
6. **Input bytes.** The port works on bytes: files opened with the file picker are used as they are,
   and pasted text is encoded as UTF-8. The old form declared no character set, so what the CGI
   received for non-ASCII characters depended on the browser.

## Quirks of the original that the port keeps

These look odd but are kept so that the output stays identical to what users got from the CGI:

- A value of exactly `0` (or an empty value) is written as an empty cell in `binned.csv` and the
  per-column files, and counts as absent in `presence.csv`. In "add" mode a sum of 0 is also empty.
- Any line containing `peak` (any case) is taken as the header row, even a data row whose sample name
  contains it; the columns are renamed from that point on.
- Data lines need a `:` somewhere and a tab. The sample name is cut at the first `:` that has text
  after it, so `S1:FAM *    1` becomes `S1`, but `replicate1:` keeps its colon.
- Lines with no whitespace at all, and lines mentioning `noise`, are skipped.
- The file type is decided by the first line only: `primerE` anywhere in it means primerE, otherwise
  the DAx and tab-delimited formats are read the same way.
- The bin width is `bin size + bin slope × (current peak length)`, compared with the distance from the
  bin's first peak. Bin size and slope are made positive (`-2` means 2); empty or non-numeric
  values count as 0. With bin size and slope both 0, every distinct length is its own bin.
- In "add" mode numbers are re-formatted the way Perl prints them (`12.50` alone stays `12.50`, but
  `12.50+0.1` becomes `12.6`; `0.1+0.2` gives `0.3`). In "keep largest" mode the original text of the
  largest value is kept.
- The list of bin starts on the results page never shows the first bin.
- A data column named `primer`, `phylip`, `binned`, `presence` or `distance` collides with an output
  file of the same name.
- `binned.csv`, `presence.csv`, `distance.csv` and the per-column tables do not end with a newline,
  and every row (including the header) ends with a tab. `primer.csv`, `phylip.csv` and the primerE
  tables end with a newline.
- primerE mode: the sample header of each file accumulates the samples of all files written before
  it; rows are sorted by the bin's average fragment length; beyond 101 peaks of one sample in one bin
  the CGI reused the first peak's values, and so does the port.
