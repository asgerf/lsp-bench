const enum Chars {
    lineFeed = 10,
    carriageReturn = 13,
}

/** 1-based line and column numbers. */
export interface LineAndColumn1 {
    line: number;
    column: number;
}

/**
 * Translates between offsets and 0-based line/column numbers.
 */
export class LineTable {
    private lineStarts: number[];

    constructor(text: string) {
        let lineStarts: number[] = [0];
        for (let i = 0, length = text.length; i < length; ++i) {
            let ch = text.charCodeAt(i);
            if (ch === Chars.lineFeed) {
                lineStarts.push(i + 1);
            } else if (ch === Chars.carriageReturn) {
                if (i + 1 < length && text.charCodeAt(i + 1) === Chars.lineFeed) {
                    ++i;
                }
                lineStarts.push(i + 1);
            }
        }
        if (lineStarts[lineStarts.length - 1] !== text.length) {
            lineStarts.push(text.length);
        }
        this.lineStarts = lineStarts;
    }

    public getStartOfLine(line: number) {
        return this.lineStarts[line];
    }

    public getLineFromOffset(offset: number) {
        return getLowerBound(this.lineStarts, offset);
    }

    public getColumnFromLineAndOffset(line: number, offset: number) {
        let start = this.lineStarts[line];
        return offset - start;
    }

    public get1BasedLineAndColumn(offset: number): LineAndColumn1 {
        let line = this.getLineFromOffset(offset);
        let column = this.getColumnFromLineAndOffset(line, offset);
        return { line: line + 1, column: column + 1 };
    }
}

/**
 * Returns the last element of `array` that is less than or equal to `value`,
 * or its first element if all elements are greater than `value`.
 *
 * The array must be sorted and non-empty.
 */
function getLowerBound(array: number[], value: number) {
    let low = 0, high = array.length - 1;
    if (value < array[0]) return 0;
    if (value >= array[high]) return high;
    while (low < high) {
      let mid = high - ((high - low) >> 1); // Get middle, rounding up.
      if (value < array[mid]) {
        high = mid - 1;
      } else {
        low = mid;
      }
    }
    return low;
}
