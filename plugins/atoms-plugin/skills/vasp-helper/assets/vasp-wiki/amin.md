# AMIN



Source: https://vasp.at/wiki/AMIN



AMIN = [real]
 Default: AMIN = min(0.1,AMIX,AMIX_MAG)

Description: AMIN specifies the minimal mixing parameter in Kerker's initial approximation1] to the charge-dielectric function used in the Broyden2]3]/Pulay4] mixing scheme (IMIX=4, INIMIX=1).

Kerker's initial approximation1] for the charge-dielectric function is given by

where [math]\displaystyle{ A }[/math]=AMIX, [math]\displaystyle{ B }[/math]=BMIX, and [math]\displaystyle{ A_{\rm min} }[/math]=AMIN.

## Related tags and articles

IMIX,
INIMIX,
MAXMIX,
AMIX,
BMIX,
AMIX_MAG,
BMIX_MAG,
MIXPRE,
WC

Examples that use this tag

## References
