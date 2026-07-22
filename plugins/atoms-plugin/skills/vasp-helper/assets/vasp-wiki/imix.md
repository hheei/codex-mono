# IMIX



Source: https://vasp.at/wiki/IMIX



IMIX = 0 | 1 | 2 | 4
 Default: IMIX = 4

Description: IMIX specifies the type of density mixing.

## IMIX=0: No mixing

## IMIX=1: Kerker mixing

| Mind: BMIX=0 might cause floating-point exceptions on some platforms. |

| --- |

## IMIX=2: Variant of Tchebycheff mixing

```
eigenvalues of (default mixing * dielectric matrix)
```

| AMIX |  | [math]\displaystyle{ ={\rm AMIX}({\rm as\; used\; in\; Pulay\; run})*{\rm smallest\; eigenvalue} }[/math] |

| --- | --- | --- |

| AMIN |  | [math]\displaystyle{ =\mu=2\sqrt{{\rm smallest\; eigenvalue}/{\rm largest\; eigenvalue}} }[/math] |

## IMIX=4: Broyden's 2nd method and Pulay-mixing method (default)

## Related tags and articles

INIMIX,
MAXMIX,
AMIX,
BMIX,
AMIX_MAG,
BMIX_MAG,
AMIN,
MIXPRE,
WC

Examples that use this tag

## References
