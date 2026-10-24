export type GradeScale = '4pt' | '1pt';

export interface GradeInfo {
  point:       number;
  letter:      string;
  description: string;
}

/* 4.0-highest scale (Raw Score → Grade Point, first table) */
const SCALE_4PT = [
  { min: 97, point: 4.0, letter: 'A',  description: 'Excellent'    },
  { min: 93, point: 3.5, letter: 'B+', description: 'Superior'     },
  { min: 89, point: 3.0, letter: 'B',  description: 'Very Good'    },
  { min: 85, point: 2.5, letter: 'C+', description: 'Good'         },
  { min: 80, point: 2.0, letter: 'C',  description: 'Satisfactory' },
  { min: 75, point: 1.5, letter: 'D+', description: 'Fair'         },
  { min: 70, point: 1.0, letter: 'D',  description: 'Pass'         },
  { min:  0, point: 0.5, letter: 'F',  description: 'Failed'       },
] as const;

/* 1.0-highest scale (5-pt grade, second table). Letters use U+2212 for the minus. */
const SCALE_1PT = [
  { min: 96, point: 1.00, letter: 'A+', description: 'Excellent' },
  { min: 94, point: 1.25, letter: 'A',  description: 'Very Good' },
  { min: 92, point: 1.50, letter: 'A−', description: 'Very Good' },
  { min: 89, point: 1.75, letter: 'B+', description: 'Good'      },
  { min: 87, point: 2.00, letter: 'B',  description: 'Good'      },
  { min: 84, point: 2.25, letter: 'B−', description: 'Good'      },
  { min: 82, point: 2.50, letter: 'C+', description: 'Fair'      },
  { min: 79, point: 2.75, letter: 'C',  description: 'Fair'      },
  { min: 75, point: 3.00, letter: 'C−', description: 'Passed'    },
  { min:  0, point: 5.00, letter: 'F',  description: 'Failed'    },
] as const;

export function toGradeInfo(pct: number, scale: GradeScale): GradeInfo {
  if (scale === '4pt') {
    const row = SCALE_4PT.find(r => pct >= r.min) ?? SCALE_4PT[SCALE_4PT.length - 1];
    return { point: row.point, letter: row.letter, description: row.description };
  }
  const row = SCALE_1PT.find(r => pct >= r.min) ?? SCALE_1PT[SCALE_1PT.length - 1];
  return { point: row.point, letter: row.letter, description: row.description };
}

/** The minimum raw % needed to achieve a given grade point (for target reverse-lookup). */
export function minPctForPoint(point: number, scale: GradeScale): number {
  if (scale === '4pt') {
    return SCALE_4PT.find(r => r.point === point)?.min ?? 0;
  }
  return SCALE_1PT.find(r => r.point === point)?.min ?? 0;
}

export const SCALE_4PT_ROWS = SCALE_4PT;
export const SCALE_1PT_ROWS = SCALE_1PT;
