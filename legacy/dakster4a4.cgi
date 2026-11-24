#!/usr/bin/perl -w
# -T for tainted mode, -w to show warnings (required)

## Dakster
#July 9, 2008
### exports text files with peak info in order by length
### can bin simply or use with primerE to bin by clusters
### can concatente, add, or keep largest if multiple peaks in one bin
### make sure sample names do not overlap

# use strict;
use CGI::Carp qw(fatalsToBrowser);
# open(LOG, ">>./RESULTS/cgilogfile.dakster.txt" ) or die("Unable to open log: $!\n");
# carpout(LOG);

use strict;
use diagnostics;
$|++;

# use Data::Dumper;
#  use CGI::Debug

# First, get the CGI variables into a list of strings
my %cgivars = &getcgivars;

# Print the CGI response header, required for all HTML output
# Note the extra \n, to send the blank line
print "Content-type: text/html\n\n";

# Finally, print out the complete HTML response page
print <<EOF ;
<html>
<head><title>Dakster</title></head>
<body>
<h2>Results Page</h2>
EOF

# Print the CGI variables sent by the user.
# Note that the order of variables is unpredictable.
# Also note this simple example assumes all input fields had unique names,
#   though the &getcgivars() routine correctly handles similarly named
#   fields-- it delimits the multiple values with the \0 character, within
#   $cgivars{$_}.
# foreach (keys %cgivars) {
#    print "<li>[$_] = [$cgivars{$_}]\n" ;
# }

##################
###################
#################

my ( $sec, $min, $hour, $day, $mon, $year, undef, undef, undef ) =
  localtime time;
$year += 1900;
$mon++;
my $timestring = "REPK_"
  . "$year$mon$day-$hour$min-$sec"
  ;    ### set to "" if don't want timestamp on files
my $binslope      = abs( $cgivars{'binslope'} );
my $binsize       = abs( $cgivars{'binsize'} );
my $daksPeakFile  = $cgivars{'globalsheet'};
$daksPeakFile =~ s/\r\n|\n|\r/\n/g;
  chomp $daksPeakFile;
  chomp $daksPeakFile;

my $multiplepeaks = $cgivars{'multiplepeaks'};
chomp $multiplepeaks;

my $daksDirString = "./RESULTS/output_dakster$year$mon$day-$hour$min-$sec";
mkdir $daksDirString, 0777;
my $daksPrintString = $daksDirString . "/";

my $xcount = 0;
my $tempbin;
my %peakHash;
my %binHash;
my @distHash;
my @newpeaks;

my @colnames;
my @colbinned = ( "binned", "presence" );
my @Samples = ();
my @uSamples;
my @Bases = ();
my @uBases;

my @peaklist;
my @binlist;
my @keylist;
my @phylip;

my @primerpeaklist;
my @primercolnames;
my @primersamples;
my @binindices;
my $minbinindex;

###
###run subroutine and print out the hash
###
my $filetype;

# FIND: while($daksPeakFile) {
# FIND: foreach ( split( "^", $daksPeakFile ) ) {
FIND: foreach (split("\n",$daksPeakFile)) {
# 	$_ =~ s/\r\n|\n|\r/\n/g;
#         chomp;chomp;

    #to parse primer files
    if    (m/primerE/) { $filetype = 'primer'; last FIND }
    elsif (m/DAx/)     { $filetype = 'dax';    last FIND }
    else               { $filetype = 'tab';    last FIND }
}

if ( $filetype eq 'primer' ) {
    %peakHash = readPrimerFile();
    print "primer file found!<br>";
}

elsif ( $filetype eq 'dax' ) {
    %peakHash = readDaxFile();
    print "dax file found!<br>";
}
else { %peakHash = readDaxFile(); print "tab-delimited file found!<br>" }

#bin them
if   ( $filetype eq 'primer' ) { primerPrintSub() }
else                           { %binHash = binSub(); daxPrintSub() }

#for distance matrix stuff
# @distHash = distSub();

# Print close of HTML file
print <<EOF ;
<h3>DONE</h3>
</body>
</html>
EOF
exit;

######################################
######################################
######################################
# # # # SUBROUTINES
######################################
######################################
######################################

######################################
# to print out binned primer import sheet
sub primerPrintSub {

# @{$primerHash{$binsize}{$primercols[$binsize]}{$primercols[3]}},@primercols[4..$minbinindex];
# @{$primerHash{'bins1bp'}{'dz'}{'024031-I_1'}{@[13.5 56.32 140.91 0.15% 0.74%]}

# print @{$primerHash{'bins1bp'}{$primercols[$binsize]}{$primercols[3]}},$primercols[1], @primercols[4..$minbinindex];

    # examples:
    #	$bingroup = 'bins1bp'
    #	$binnames = 'dz'
    #

    # print Dumper %peakHash;
    # print join("\t",@{$peakHash{'bins1bp'}{'dz'}{'024031-I_1'}});

    my @allsamples;	
    my @binsbp = grep( /bins/, @primercolnames );

    # traitnames:
    my @traitnames =
      ( @primercolnames[1], @primercolnames[ 4 .. $minbinindex ] );
    my $numtraits = @traitnames;

    for ( my $trait = 0 ; $trait < @traitnames ; $trait++ ) {

        foreach my $bingroup (@binsbp) {

            open( OUT,
                    '>'
                  . $daksPrintString
                  . 'primer-'
                  . $bingroup . '-'
                  . $traitnames[$trait]
                  . '.csv' )
              or die "Couldn't open new file $!";
            print
"<br><a href=\"./$daksDirString/primer-$bingroup-$traitnames[$trait].csv\">primer $bingroup-$traitnames[$trait]</a>: output from primer distance matrix binning";

            my @binnames = ();
	    @binnames = sort keys %{ $peakHash{$bingroup} };

            #get unique sample names:
            foreach my $bin (@binnames) {
                my @keys = sort keys( %{ $peakHash{$bingroup}{$bin} } );
                push( @allsamples, @keys );
            }
            my %saw;
            undef %saw;
            @saw{@allsamples} = ();
            @allsamples = sort keys %saw;    # remove sort if undesired
            print OUT "\t" . join( "\t", @allsamples ) . "\n";

            my @savetoprint = ();

            foreach my $bin (@binnames) {
                my $linetoprint;
                my @samples = ();

                @samples = sort keys( %{ $peakHash{$bingroup}{$bin} } );

                #     print join("\t",@samples);

 #to get average value for each bin, including those with multiple peaks per bin
                my $samples         = 0;              #= scalar(@samples);
                my $binsum          = 0;
                my $binavg          = 0;
                my $multibins       = 0;
                my @multibinindices = ( 0 .. 100 );
                foreach (@multibinindices) { $_ *= $numtraits }
                my @touse = ();
                my @mbins = ();

                foreach my $samplename (@samples) {
                    $multibins =
                      ( @{ $peakHash{$bingroup}{$bin}{$samplename} } /
                          $numtraits );  #print "$samplename: $multibins<br>\n";
                    push( @mbins, $multibins );
                    $samples += $multibins;
                    @touse = @multibinindices[ 0 .. $multibins - 1 ]
                      ;                  #print "$multibins bins: @touse\n<br>";
                    my @binsumarray =
                      @{ $peakHash{$bingroup}{$bin}{$samplename} }[@touse]
                      ;                  #print "@traitarray\n<br>";
                    foreach (@binsumarray) {
                        $binsum += $_;
                    }    #{$peakHash{$bingroup}{$bin}{$samplename}}[0]};
                }
                $binavg = $binsum / $samples;

# 	print "actual: @{$peakHash{$bingroup}{$bin}{$samplename}}[0], average: $binavg<br>\n";
                $linetoprint .= "$binavg\t";

# print Dumper(%peakHash);
                foreach my $allsamplename (@allsamples) {
                    if ( grep( /^$allsamplename$/, @samples ) ) {
# print "1 $bingroup\t2 $bin\t3 $allsamplename\t4 $numtraits\t5 $peakHash{$bingroup}{$bin}{$allsamplename}\<br\>\n";
                        $multibins =
                          ( @{ $peakHash{$bingroup}{$bin}{$allsamplename} } /
                              $numtraits )
                          ;    #print "$samplename: $multibins<br>\n";
                        @touse = @multibinindices[ 0 .. $multibins - 1 ]
                          ;    #print "$multibins bins: @touse\n<br>";
                        foreach (@touse) { $_ += $trait }; #print "$multibins traits: @newtouse\n<br>";
                        my @traitarray =
                          @{ $peakHash{$bingroup}{$bin}{$allsamplename} }
                          [@touse];

   # 		$linetoprint .="${$peakHash{$bingroup}{$bin}{$allsamplename}}[$trait]\t";
                        if ( $multiplepeaks eq 'add' ) {
                            my $arraysum;
                            foreach (@traitarray) { $arraysum += $_ }
                            $linetoprint .= "$arraysum\t";
                        }

                        # if choose 'keeplarge' then keep largest only
                        elsif ( $multiplepeaks eq 'keeplarge' ) {
                            my $max = pop(@traitarray);
                            foreach (@traitarray) { $max = $_ if $_ > $max }
                            $linetoprint .= "$max\t";
                        }

                   # if choose other ('concatenate') then concatenate to the bin
                        elsif ( $multiplepeaks eq 'concatenate' ) {
                            $linetoprint .= join( '+', @traitarray ) . "\t";
                        }
                    }
                    else { $linetoprint .= "\t"; }
                }
                $linetoprint .= "\n";
                push( @savetoprint, $linetoprint );
            }

            foreach my $lines ( sort { $a <=> $b } @savetoprint ) {
                print OUT $lines;
            }
            close OUT or die "couldn't close output file $!";
        }
    }
}

######################################

sub daxPrintSub {

    # # # # # ROUTINES FOR PRINTING OUTFILES
    # k1 = peak lengths
    # k2 = sample name
    # k3 = data column/sheet

    for my $k1 ( sort { $a <=> $b } keys %peakHash ) {
        push @peaklist, $k1;
    }
    for my $k1 ( sort { $a <=> $b } keys %binHash ) {
        push @binlist, $k1;
    }
    my $topstrings = "\t";
    for my $k2 ( sort { $a cmp $b } keys %{ $peakHash{ $peaklist[0] } } ) {
        $topstrings .= "$k2\t";
    }

#     print "colnames: " . join('-',@colnames) . "<br>\n";
    my @newcolnames = @colnames[ 0 .. $#colnames ];
    push( @newcolnames, 'binned', 'presence', 'distance' );

####to print out PRIMER export sheet
    open( OUT, '>' . $daksPrintString . 'primer.csv' )
      or die "Couldn't open new file $!";

    for my $lengths ( sort { $a <=> $b } keys %peakHash ) {
        push @primerpeaklist, $lengths;
    }

    print OUT "ID\tpeak\t\tsample\t" . join( "\t", @colnames ) . "\n";
    foreach my $peak (@primerpeaklist) {
        for my $samples ( keys %{ $peakHash{$peak} } ) {
            my @catcols;
            foreach my $columns (@colnames) {
                push( @catcols, $peakHash{$peak}{$samples}{$columns} );
            }

            print OUT ( "$samples-$peak\t$peak\t\t$samples\t"
                  . join( "\t", @catcols )
                  . "\n" )
              if defined $peakHash{$peak}{$samples}{ $colnames[0] };
        }
    }
    close OUT or die "couldn't close output file $!";
    print
"<br><a href=\"./$daksDirString/primer.csv\">primer</a>: input for primer to do distance matrix binning";
###

    foreach my $k3 (@newcolnames) {
        my $phylipcount = 0;
        open( OUT, '>' . $daksPrintString . $k3 . '.csv' )
          or die "Couldn't open new file $!";
        print OUT "$topstrings";

        if   ( grep( $k3 eq $_, @colbinned ) ) { @keylist = @binlist }
        else                                   { @keylist = @peaklist }

        foreach my $k1 (@keylist) {
            print OUT "\n$k1\t";

            for my $k2 ( sort { $a cmp $b } @uSamples ) {

                if ( $k3 eq 'binned' ) {
                    ( $binHash{$k1}{$k2} )
                      ? ( print OUT "$binHash{$k1}{$k2}\t" )
                      : ( print OUT "\t" );
                }
                elsif ( $k3 eq 'presence' ) {
                    if ( $binHash{$k1}{$k2} ) {
                        print OUT "1\t";
                        $phylip[$phylipcount] .= 1;
                    }
                    else {
                        print OUT "0\t";
                        $phylip[$phylipcount] .= 0;
                    }
                }

#elsif ($k3 eq 'distance') {($distHash{$k1}{$k2}{$k3}) ? (print OUT "$distHash{$k1}{$k2}{$k3}\t") : (print OUT "\t");}
                else {
                    ( $peakHash{$k1}{$k2}{$k3} )
                      ? ( print OUT "$peakHash{$k1}{$k2}{$k3}\t" )
                      : ( print OUT "\t" );
                }
            }
            $phylipcount++;
        }
        close OUT or die "couldn't close output file $!";

        if ( $k3 eq 'binned' ) {
            print
"<br><a href=\"./$daksDirString/binned.csv\">binned</a>: binned $colnames[0]";
        }
        elsif ( $k3 eq 'presence' ) {
            print
"<br><a href=\"./$daksDirString/presence.csv\">presence</a>:$colnames[0] presence/absence matrix";
        }

# elsif ($k3 eq 'distmatrix') {print "<br><a href=\"./$daksDirString/presence.csv\">distance</a>:$colnames[0] distance matrix";}
        else {
            print
              "<br><a href=\"./$daksDirString/$k3.csv\">$k3</a>: all peak $k3";
        }
    }

    my $transposeOut = transposeSub( $daksPrintString . 'presence.csv' );
    print
"<br><a href=\"./$daksDirString/phylip.csv\">phylip</a>: binned $colnames[0] \=\> phylip infile";

}

######################################

#subroutine to parse primer files
sub readPrimerFile {

# 	peak		sample	Height	AreaY	AreaFract	bins2bp
# AN421_435NC-60.0	60		AN421_435NC	676.13	598.16	1.86%	gj

    my $primerrow = 0;
    my %primerHashSub;
#   PRLINE: foreach ( split( "^", $daksPeakFile ) ) {
# PRLINE: while(<$daksPeakFile>) {
PRLINE: foreach (split("\n",$daksPeakFile)) {

# 	$_ =~ s/\r\n|\n|\r/\n/g;
#         chomp;chomp;
        next PRLINE if (m/^\s*$/);
        $primerrow++;

        #parses the primer header row
        if ( $primerrow == 2 ) {
            @primercolnames = split(/\t/);
# print @primercolnames;
            #to get bin indices
            foreach (@primercolnames) { s/[\%\s\(\)\.\\\/']+//g }
	    chomp @primercolnames;
            for ( my $colindex = 0 ; $colindex < @primercolnames ; $colindex++ )
            {
                if ( $primercolnames[$colindex] =~ m/^bins/ ) {
                    push( @binindices, $colindex );
                }
            }
            $minbinindex = $binindices[0] - 1;    #for push later to only include data not bininfo

            # 		shift @primercolnames; #to get rid of blank ID cell
            # 		shift @primercolnames; #to get ride basepairs
            # 		shift @primercolnames; #to get rid of blank cell
            next PRLINE;

        }

        #parses the primer body rows
        elsif ( $primerrow > 2 ) {

            my @primercols = split(/\t/);
            foreach (@primercols) { s/[\r\l\n]//g }
            chomp @primercols;
            chomp @primercols;
            chomp @primercols;
            foreach my $binsize (@binindices) {

# 			  if ($primerHashSub{$primercolnames[$binsize]}{$primercols[$binsize]}{$primercols[3]}[0] ) {
# 			    print "$primercolnames[$binsize] @primercols already defined: ".$primerHashSub{$binsize}{$primercols[$binsize]}{$primercols[3]}[0]."<br>\n";
# 			    my @toadd = ($primercols[1], @primercols[4..$minbinindex]);
# 			    foreach my $column (@{$primerHashSub{$binsize}{$primercols[$binsize]}{$primercols[3]}}) {
# 			    ${$primerHashSub{$binsize}{$primercols[$binsize]}{$primercols[3]}}[$column] .= $primercols[$column];
# 			    }
# 			  }
# 			  else {
                push(
                    @{
                        $primerHashSub{ $primercolnames[$binsize] }
                          { $primercols[$binsize] }{ $primercols[3] }
                      },
                    $primercols[1],
                    @primercols[ 4 .. $minbinindex ]
                );

                # 			  }

# 			  print "$binsize - @{$primerHashSub{$binsize}{$primercols[$binsize]}{$primercols[3]}})\n";
            }

            next PRLINE;
        }
    }

    print Dumper %primerHashSub;
    # @distHash = distSub();

    return %primerHashSub;

}

######################################

########subroutine to hash the dax file
sub readDaxFile {
    print "reading file<br>\n";
    my %daxHashSub = ();
#   DAXLINE: foreach ( split( "^", $daksPeakFile ) ) {	
#   DAXLINE: while(<$daksPeakFile>) {
DAXLINE: foreach (split("\n",$daksPeakFile)) {
# 	$_ =~ s/\r\n|\n|\r/\n/g;
#         chomp;chomp;
        next DAXLINE if (m/^\S*$/);

        if (m/Peak/i) {
            @colnames = split(/\t/);
            my $sample = shift @colnames;    #to get rid of Peak
            my $base   = shift @colnames;    #to get rid of basepairs

            foreach (@colnames) { s/[\%\s\(\)\.\\\/']+//g } #replace weird characters

            # 		print join("-",@colnames);
            next DAXLINE;
        }

        elsif (m/:/) {
            if (m/noise/i) {

                # 		push my(@{$noise{$inputFile}}), $_;
                next DAXLINE;
            }

            elsif (m/\t/) {

                my @Cols = split(/\t/);
                foreach (@Cols) { s/[\r\n]//; s/:.+//; }
                chomp @Cols;
                chomp @Cols;
                chomp @Cols;

                # 			print "$Cols[0] - $Cols[1]<br>";
                # 			print "samples = @Samples<br>";
                # 			print "bases = @Bases<br>";
                push( @Samples, $Cols[0] );
                for ( my $i = 0 ; $i < @colnames ; $i++ ) {
                    $daxHashSub{ $Cols[1] }{ $Cols[0] }{ $colnames[$i] } =
                      $Cols[ $i + 2 ];
                }
            }

            # 	print Dumper %peakHashSub;print "<br><br>";
        }
        else { next DAXLINE }
    }

    undef my %saw;
    @uSamples = grep( !$saw{$_}++, @Samples );
    @uBases = keys %daxHashSub;

    # print Dumper %peakHashSub;
    # @distHash = distSub();
    print "\n<br>";
    return %daxHashSub;

}

######################################

sub binSub {
    #k1 = fragment length
    #key2 = sample name
    #tempbin = beginning of current bin
    #xcount = to make sure no peaks get skipped over when moving to new bin?
    #binsize can be a linear function of peak size (i.e. base pairs)
    my %binHashSub = ();
    print "Your multiple peaks method is $multiplepeaks<br>";
    if ( $binslope > 0 ) {
        print
"The starting point of your bins (bp), and their widths (using the equation  <font size=+1>y = $binslope * x + $binsize </font>) are as follows: <br>bp,width<br>";
    }
    else { print "Your bin width is $binsize bp.<br>"; }

    my $keyschecked = 0;

    print "binning the peaks<br>\n";
    ### bin the hash
  KEY: foreach my $k1 ( sort { $a <=> $b } @uBases ) {
        
        my $ybin = $binsize + $binslope * $k1;
        my $rybin = sprintf( "%.1f", $ybin );

        $tempbin = $k1 if $xcount == 0;

        #WHY ISN'T THIS WORKING
        ( ( $keyschecked++ ) && ( print "$tempbin,$rybin<br>" ) )
          if ( ( $keyschecked == 0 ) && ( $binslope > 0 ) );

        # if the new fragment length is within the old bin
        if ( ( abs( $k1 - $tempbin ) < $ybin ) || ( $xcount == 0 ) ) {
            $xcount++;

            foreach my $key2 ( sort { $a cmp $b } @uSamples ) {

                # if the sample has a peak height within the new bin...
                if ( defined $peakHash{$k1}{$key2}{ $colnames[0] } ) {

             # and if that bin already has a peak assigned to it for that sample
                    if ( defined $binHashSub{$tempbin}{$key2} ) {

            # print "$tempbin - $key2 - $binHashSub{$tempbin}{$key2}<br>";

                        # if choose 'add' then add them together
                        if ( $multiplepeaks eq 'add' ) {
                            $binHashSub{$tempbin}{$key2} =
                              ( $binHashSub{$tempbin}{$key2} +
                                  $peakHash{$k1}{$key2}{ $colnames[0] } );
                        }

                        # if choose 'keeplarge' then keep largest only
                        elsif ( $multiplepeaks eq 'keeplarge' ) {
                            if ( $peakHash{$k1}{$key2}{ $colnames[0] } >
                                $binHashSub{$tempbin}{$key2} )
                            {
                                $binHashSub{$tempbin}{$key2} =
                                  $peakHash{$k1}{$key2}{ $colnames[0] };
                            }
                        }

                   # if choose other ('concatenate') then concatenate to the bin
                        elsif ( $multiplepeaks eq 'concatenate' ) {
                            $binHashSub{$tempbin}{$key2} .=
                              '+' . $peakHash{$k1}{$key2}{ $colnames[0] };
                        }
                    }

# and if that bin does not have any peaks assigned to it for that sample, add it
                    else {
                        $binHashSub{$tempbin}{$key2} =
                          $peakHash{$k1}{$key2}{ $colnames[0] };
                    }
                }

# if the sample does not have a peak height within the new bin
# then assign it (the null peakvalue) unless it already has a fragment in that bin
                else {
                    ( $binHashSub{$tempbin}{$key2} =
                          $peakHash{$k1}{$key2}{ $colnames[0] } )
                      unless ( exists $binHashSub{$tempbin}{$key2} );
                }

                # then check every sample for a peak
            }
        }

# if the new fragment length is outside the old bin, assign the beginning of the new bin to that length
# and start binning over again with the same fragment length
        else {
            $tempbin = $k1;
            $xcount  = 0;
            print "$tempbin,$rybin<br>" if ( $binslope > 0 );
            redo KEY;

        }

    }
    return %binHashSub;
}

################################3
sub distSub {
    my @distHashSub = ();
    my $k3          = 'Height';
    my @sortSamples;

    for my $k1 ( sort { $a <=> $b } keys %peakHash ) {
        push @peaklist, $k1;
    }
    for my $k2 ( sort { $a cmp $b } @uSamples ) {
        push @sortSamples, $k2;
    }
    my $i = 0;

    # print Dumper %peakHashSub;

    foreach my $k1 (@peaklist) {
        foreach my $k2 ( keys %{ $peakHash{$k1} } ) {
            my $j = 0;
            foreach my $k11 (@peaklist) {
                foreach my $k22 ( keys %{ $peakHash{$k11} } ) {

                    #    print "$k1:$k11 - $k2:$k22<br>\n";
                    #      print "$i,$j: (abs($k1 - $k11))<br>";
                    $distHashSub[$i][$j] = abs( $k1 - $k11 );
                    my $tempstring = "$k11-$k22";
                    my $tempsubstr = substr( $tempstring, 0, 10 );
                    push( @newpeaks, $tempsubstr );
                    $j++;
                }
            }
            $i++;
        }

    }

    # print Dumper @distHashSub;

    open( OUT, '>' . $daksPrintString . 'distmatrix.csv' )
      or die "Couldn't open new file $!";

    # print OUT join('-',@peaklist);
    # my $size = sqrt(scalar @newpeaks)-1;

    # print OUT "$size\t|\n";

    for ( my $a1 = 0 ; $a1 < $#distHashSub ; $a1++ ) {

        ( defined $newpeaks[$a1] )
          ? print OUT "$newpeaks[$a1]|"
          : print OUT "nd\t";

        for ( my $a2 = 0 ; $a2 < $#distHashSub ; $a2++ ) {
            print OUT "\t$distHashSub[$a1][$a2]";
        }
        print OUT "\n";
    }
    close OUT or die "couldn't close output file $!";

    print
"<br><a href=\"./$daksDirString/distmatrix.csv\">distmatrix</a>: all \=\> distance matrix";

    return @distHashSub;
}

######################################

sub transposeSub {
######### excerpted from
    # Transpose line <-> columns
    # Didier Gonze
    # 12/12/2003

###### read data to transpose

    my $transfile = shift;

    open( TRIN, $transfile ) or die "Couldn't open new file $!";

    my $jcount;
    my @R;
    my $i      = 0;
    my $icount = 0;
    my @line;

    foreach my $line (<TRIN>) {
        chomp $line;
        @line = split /\t/, $line;
        $jcount = 0;
        for ( my $j = 1 ; $j <= $#line ; $j++ ) {
            $R[$i][$j] = $line[$j];

            $jcount++;
        }
        $i++;
        $icount++;
    }
    $icount--;
    my $nlin = $i - 1;
    my $ncol = $#line;
    close TRIN or die "couldn't close output file $!";

    open( TROUT, '>' . $daksPrintString . 'phylip.csv' );
### write tranposed data to file
    print TROUT "$jcount $icount 1";
    for ( my $i = 0 ; $i <= $ncol ; $i++ ) {
        for ( my $j = 0 ; $j <= $nlin ; $j++ ) {
            print TROUT "$R[$j][$i]";

            if ( $j == 0 ) {
                print TROUT "\t";
            }
        }
        print TROUT "\n";
    }
    close TROUT or die "couldn't close output file $!";

}

######################################

sub jaccardSub {
    my @newcount;
    for ( my $a1 = 0 ; $a1 < $#phylip + 1 ; $a1++ ) {
        my $scal = length( $phylip[$a1] );
        for ( my $a2 = 0 ; $a2 < $scal ; $a2++ ) {

            #    print "<br>$a1-$a2-$scal-$phylip[$a1]\t";
            $newcount[$a1] += chop $phylip[$a1];
        }
        print "$newcount[$a1]\t";
    }
    print "\n";
}

jaccardSub();

######################################

sub getcgivars {

   #----------------- start of &getcgivars() module ----------------------
   # by James Marshall (http://www.jmarshall.com/easy/cgi/hello.pl.txt)
   # Read all CGI vars into an associative array.
   # If multiple input fields have the same name, they are concatenated into
   #   one array element and delimited with the \0 character (which fails if
   #   the input has any \0 characters, very unlikely but conceivably possible).
   # Currently only supports Content-Type of application/x-www-form-urlencoded.

    my $in;
    my %in;
    my $name;
    my $value;

    # First, read entire string of CGI vars into $in
    if (   ( $ENV{'REQUEST_METHOD'} eq 'GET' )
        || ( $ENV{'REQUEST_METHOD'} eq 'HEAD' ) )
    {
        $in = $ENV{'QUERY_STRING'};

    }
    elsif ( $ENV{'REQUEST_METHOD'} eq 'POST' ) {
        if ( $ENV{'CONTENT_TYPE'} =~ m#^application/x-www-form-urlencoded$#i ) {
            length( $ENV{'CONTENT_LENGTH'} )
              || &HTMLdie("No Content-Length sent with the POST request.");
            read( STDIN, $in, $ENV{'CONTENT_LENGTH'} );

        }
        else {
            &HTMLdie("Unsupported Content-Type: $ENV{'CONTENT_TYPE'}");
        }

    }
    else {
        &HTMLdie("Script was called with unsupported REQUEST_METHOD.");
    }

    # Resolve and unencode name/value pairs into %in
    foreach ( split( /[&;]/, $in ) ) {

        #     	$OK_CHARS='-a-zA-Z0-9_.;';	# A restrictive list, which
        # 					# should be modified to match
        # 					# an appropriate RFC, for example.
        # 	s/[^$OK_CHARS]/blah/go; ##insert for security
        # 	s/[az]+/ /go; ##insert for security

        s/\+/ /g;
        ( $name, $value ) = split( '=', $_, 2 );
        $name  =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
        $value =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/ge;
        $in{$name} .= "\0" if defined( $in{$name} ); # concatenate multiple vars
        $in{$name} .= $value;
    }

    # print Dumper %in;
    return %in;

}

######################################

# Die, outputting HTML error page
# If no $title, use a default title
sub HTMLdie {
    my $msg   = @_;
    my $title = @_;
    $title = "CGI Error" if $title eq '';
    print <<EOF ;
Content-type: text/html

<html>
<head>
<title>$title</title>
</head>
<body>
<h1>$title</h1>
<h3>$msg</h3>
</body>
</html>
EOF

    exit;
}
