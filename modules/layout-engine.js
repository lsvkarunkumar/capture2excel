export class LayoutEngine {
  constructor() {
    this.version = "1.3.0";
  }

  analyze(source) {
    const canvas = this.#toCanvas(source);

    const context = canvas.getContext("2d", {
      willReadFrequently: true,
    });

    if (!context) {
      throw new Error("Unable to read image canvas.");
    }

    const imageData = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const grayscale = this.#createGrayscale(
      imageData.data,
      canvas.width,
      canvas.height,
    );

    const threshold = this.#calculateThreshold(grayscale);

    const reportBounds = this.#detectReportBounds(
      grayscale,
      canvas.width,
      canvas.height,
      threshold,
    );

    const verticalColumns = this.#detectVerticalColumns(
      grayscale,
      canvas.width,
      canvas.height,
      threshold,
      reportBounds,
    );

    const horizontalRows = this.#detectHorizontalRows(
      grayscale,
      canvas.width,
      canvas.height,
      threshold,
      reportBounds,
    );

    return {
      pageWidth: canvas.width,
      pageHeight: canvas.height,
      threshold,

      reportBounds,
      verticalColumns,
      horizontalRows,

      detectedSections: {
        header: null,
        fieldData: null,
        soilDescription: null,
        laboratory: null,
        legend: null,
      },
    };
  }

  #toCanvas(source) {
    if (source instanceof HTMLCanvasElement) {
      return source;
    }

    const width =
      source.naturalWidth ||
      source.videoWidth ||
      source.width;

    const height =
      source.naturalHeight ||
      source.videoHeight ||
      source.height;

    if (!width || !height) {
      throw new Error("Invalid image source dimensions.");
    }

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to create analysis canvas.");
    }

    context.drawImage(
      source,
      0,
      0,
      width,
      height,
    );

    return canvas;
  }

  #detectReportBounds(
    grayscale,
    width,
    height,
    threshold,
  ) {
    const rowScores = new Float32Array(height);
    const columnScores = new Float32Array(width);

    const horizontalMargin = Math.floor(width * 0.02);
    const verticalMargin = Math.floor(height * 0.02);

    for (
      let y = verticalMargin;
      y < height - verticalMargin;
      y += 1
    ) {
      let darkPixels = 0;

      for (
        let x = horizontalMargin;
        x < width - horizontalMargin;
        x += 1
      ) {
        if (grayscale[y * width + x] < threshold) {
          darkPixels += 1;
        }
      }

      rowScores[y] =
        darkPixels /
        Math.max(
          1,
          width - horizontalMargin * 2,
        );
    }

    for (
      let x = horizontalMargin;
      x < width - horizontalMargin;
      x += 1
    ) {
      let darkPixels = 0;

      for (
        let y = verticalMargin;
        y < height - verticalMargin;
        y += 1
      ) {
        if (grayscale[y * width + x] < threshold) {
          darkPixels += 1;
        }
      }

      columnScores[x] =
        darkPixels /
        Math.max(
          1,
          height - verticalMargin * 2,
        );
    }

    const top = this.#findFirstStrongPosition(
      rowScores,
      verticalMargin,
      height - verticalMargin,
      0.08,
    );

    const bottom = this.#findLastStrongPosition(
      rowScores,
      verticalMargin,
      height - verticalMargin,
      0.08,
    );

    const left = this.#findFirstStrongPosition(
      columnScores,
      horizontalMargin,
      width - horizontalMargin,
      0.08,
    );

    const right = this.#findLastStrongPosition(
      columnScores,
      horizontalMargin,
      width - horizontalMargin,
      0.08,
    );

    const fallbackPaddingX = Math.round(width * 0.03);
    const fallbackPaddingY = Math.round(height * 0.03);

    const safeLeft =
      left === null
        ? fallbackPaddingX
        : left;

    const safeRight =
      right === null
        ? width - fallbackPaddingX
        : right;

    const safeTop =
      top === null
        ? fallbackPaddingY
        : top;

    const safeBottom =
      bottom === null
        ? height - fallbackPaddingY
        : bottom;

    return {
      x: safeLeft,
      y: safeTop,
      width: Math.max(
        1,
        safeRight - safeLeft,
      ),
      height: Math.max(
        1,
        safeBottom - safeTop,
      ),
      confidence: this.#calculateBoundsConfidence(
        left,
        right,
        top,
        bottom,
      ),
    };
  }

  #detectVerticalColumns(
    grayscale,
    width,
    height,
    threshold,
    reportBounds,
  ) {
    const startX = Math.max(
      0,
      Math.floor(reportBounds.x),
    );

    const endX = Math.min(
      width - 1,
      Math.ceil(
        reportBounds.x + reportBounds.width,
      ),
    );

    const startY = Math.max(
      0,
      Math.floor(
        reportBounds.y +
        reportBounds.height * 0.06,
      ),
    );

    const endY = Math.min(
      height - 1,
      Math.ceil(
        reportBounds.y +
        reportBounds.height * 0.95,
      ),
    );

    const scores = new Float32Array(width);
    const scanHeight = Math.max(1, endY - startY + 1);

    for (
      let x = startX;
      x <= endX;
      x += 1
    ) {
      let darkPixels = 0;
      let longestRun = 0;
      let currentRun = 0;

      for (
        let y = startY;
        y <= endY;
        y += 1
      ) {
        const isDark =
          grayscale[y * width + x] < threshold;

        if (isDark) {
          darkPixels += 1;
          currentRun += 1;
          longestRun = Math.max(
            longestRun,
            currentRun,
          );
        } else {
          currentRun = 0;
        }
      }

      const darkRatio = darkPixels / scanHeight;
      const runRatio = longestRun / scanHeight;

      scores[x] =
        darkRatio * 0.45 +
        runRatio * 0.55;
    }

    const smoothed = this.#smoothScores(
      scores,
      2,
      startX,
      endX,
    );

    const groups = this.#findScoreGroups(
      smoothed,
      startX,
      endX,
      0.18,
    );

    const lines = groups
      .map((group) => {
        const strongest = this.#findStrongestPosition(
          smoothed,
          group.start,
          group.end,
        );

        return {
          x: strongest.position,
          score: strongest.score,
          thickness:
            group.end - group.start + 1,
        };
      })
      .filter((line) => {
        return (
          line.score >= 0.2 &&
          line.thickness <=
            Math.max(
              12,
              Math.round(width * 0.015),
            )
        );
      });

    const merged = this.#mergeNearbyAxisLines(
      lines,
      "x",
      Math.max(
        4,
        Math.round(width * 0.004),
      ),
    );

    this.#addBoundaryAxisLineIfMissing(
      merged,
      "x",
      Math.round(reportBounds.x),
      width,
    );

    this.#addBoundaryAxisLineIfMissing(
      merged,
      "x",
      Math.round(
        reportBounds.x +
        reportBounds.width,
      ),
      width,
    );

    return merged
      .sort((a, b) => a.x - b.x)
      .map((line, index) => ({
        index: index + 1,
        x: line.x,
        relativeX:
          reportBounds.width > 0
            ? Number(
                (
                  (
                    line.x -
                    reportBounds.x
                  ) /
                  reportBounds.width
                ).toFixed(4),
              )
            : 0,
        confidence: Math.round(
          Math.min(
            100,
            line.score * 100,
          ),
        ),
      }));
  }

  #detectHorizontalRows(
    grayscale,
    width,
    height,
    threshold,
    reportBounds,
  ) {
    const startX = Math.max(
      0,
      Math.floor(reportBounds.x),
    );

    const endX = Math.min(
      width - 1,
      Math.ceil(
        reportBounds.x + reportBounds.width,
      ),
    );

    const startY = Math.max(
      0,
      Math.floor(reportBounds.y),
    );

    const endY = Math.min(
      height - 1,
      Math.ceil(
        reportBounds.y + reportBounds.height,
      ),
    );

    const scores = new Float32Array(height);
    const scanWidth = Math.max(1, endX - startX + 1);

    for (
      let y = startY;
      y <= endY;
      y += 1
    ) {
      let darkPixels = 0;
      let longestRun = 0;
      let currentRun = 0;

      for (
        let x = startX;
        x <= endX;
        x += 1
      ) {
        const isDark =
          grayscale[y * width + x] < threshold;

        if (isDark) {
          darkPixels += 1;
          currentRun += 1;
          longestRun = Math.max(
            longestRun,
            currentRun,
          );
        } else {
          currentRun = 0;
        }
      }

      const darkRatio = darkPixels / scanWidth;
      const runRatio = longestRun / scanWidth;

      scores[y] =
        darkRatio * 0.45 +
        runRatio * 0.55;
    }

    const smoothed = this.#smoothScores(
      scores,
      2,
      startY,
      endY,
    );

    const groups = this.#findScoreGroups(
      smoothed,
      startY,
      endY,
      0.16,
    );

    const lines = groups
      .map((group) => {
        const strongest = this.#findStrongestPosition(
          smoothed,
          group.start,
          group.end,
        );

        return {
          y: strongest.position,
          score: strongest.score,
          thickness:
            group.end - group.start + 1,
        };
      })
      .filter((line) => {
        return (
          line.score >= 0.18 &&
          line.thickness <=
            Math.max(
              12,
              Math.round(height * 0.01),
            )
        );
      });

    const merged = this.#mergeNearbyAxisLines(
      lines,
      "y",
      Math.max(
        4,
        Math.round(height * 0.003),
      ),
    );

    this.#addBoundaryAxisLineIfMissing(
      merged,
      "y",
      Math.round(reportBounds.y),
      height,
    );

    this.#addBoundaryAxisLineIfMissing(
      merged,
      "y",
      Math.round(
        reportBounds.y +
        reportBounds.height,
      ),
      height,
    );

    return merged
      .sort((a, b) => a.y - b.y)
      .map((line, index) => ({
        index: index + 1,
        y: line.y,
        relativeY:
          reportBounds.height > 0
            ? Number(
                (
                  (
                    line.y -
                    reportBounds.y
                  ) /
                  reportBounds.height
                ).toFixed(4),
              )
            : 0,
        confidence: Math.round(
          Math.min(
            100,
            line.score * 100,
          ),
        ),
      }));
  }

  #findScoreGroups(
    scores,
    start,
    end,
    minimumScore,
  ) {
    const groups = [];
    let groupStart = null;

    for (
      let index = start;
      index <= end;
      index += 1
    ) {
      if (scores[index] >= minimumScore) {
        if (groupStart === null) {
          groupStart = index;
        }
      } else if (groupStart !== null) {
        groups.push({
          start: groupStart,
          end: index - 1,
        });

        groupStart = null;
      }
    }

    if (groupStart !== null) {
      groups.push({
        start: groupStart,
        end,
      });
    }

    return groups;
  }

  #findStrongestPosition(
    scores,
    start,
    end,
  ) {
    let position = start;
    let score = scores[start];

    for (
      let index = start + 1;
      index <= end;
      index += 1
    ) {
      if (scores[index] > score) {
        score = scores[index];
        position = index;
      }
    }

    return {
      position,
      score,
    };
  }

  #mergeNearbyAxisLines(
    lines,
    coordinateKey,
    maximumDistance,
  ) {
    if (lines.length === 0) {
      return [];
    }

    const sorted = [...lines].sort(
      (first, second) =>
        first[coordinateKey] -
        second[coordinateKey],
    );

    const merged = [];
    let current = { ...sorted[0] };

    for (
      let index = 1;
      index < sorted.length;
      index += 1
    ) {
      const next = sorted[index];

      if (
        next[coordinateKey] -
          current[coordinateKey] <=
        maximumDistance
      ) {
        if (next.score > current.score) {
          current = { ...next };
        }
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);

    return merged;
  }

  #addBoundaryAxisLineIfMissing(
    lines,
    coordinateKey,
    target,
    dimension,
  ) {
    const tolerance = Math.max(
      6,
      Math.round(dimension * 0.006),
    );

    const exists = lines.some((line) => {
      return (
        Math.abs(
          line[coordinateKey] - target,
        ) <= tolerance
      );
    });

    if (!exists) {
      lines.push({
        [coordinateKey]: target,
        score: 0.5,
        thickness: 1,
      });
    }
  }

  #smoothScores(
    scores,
    radius,
    start,
    end,
  ) {
    const output = new Float32Array(
      scores.length,
    );

    for (
      let index = start;
      index <= end;
      index += 1
    ) {
      let sum = 0;
      let count = 0;

      const from = Math.max(
        start,
        index - radius,
      );

      const to = Math.min(
        end,
        index + radius,
      );

      for (
        let position = from;
        position <= to;
        position += 1
      ) {
        sum += scores[position];
        count += 1;
      }

      output[index] =
        count > 0
          ? sum / count
          : 0;
    }

    return output;
  }

  #createGrayscale(
    data,
    width,
    height,
  ) {
    const grayscale = new Uint8Array(
      width * height,
    );

    for (
      let pixelIndex = 0,
        grayIndex = 0;
      pixelIndex < data.length;
      pixelIndex += 4,
        grayIndex += 1
    ) {
      const red = data[pixelIndex];
      const green = data[pixelIndex + 1];
      const blue = data[pixelIndex + 2];

      grayscale[grayIndex] = Math.round(
        red * 0.299 +
        green * 0.587 +
        blue * 0.114,
      );
    }

    return grayscale;
  }

  #calculateThreshold(grayscale) {
    let total = 0;

    for (const value of grayscale) {
      total += value;
    }

    const mean =
      total /
      Math.max(
        1,
        grayscale.length,
      );

    return Math.max(
      80,
      Math.min(
        210,
        mean - 35,
      ),
    );
  }

  #findFirstStrongPosition(
    scores,
    start,
    end,
    minimumScore,
  ) {
    const requiredRun = 2;
    let runLength = 0;

    for (
      let index = start;
      index < end;
      index += 1
    ) {
      if (scores[index] >= minimumScore) {
        runLength += 1;

        if (runLength >= requiredRun) {
          return (
            index -
            requiredRun +
            1
          );
        }
      } else {
        runLength = 0;
      }
    }

    return null;
  }

  #findLastStrongPosition(
    scores,
    start,
    end,
    minimumScore,
  ) {
    const requiredRun = 2;
    let runLength = 0;

    for (
      let index = end - 1;
      index >= start;
      index -= 1
    ) {
      if (scores[index] >= minimumScore) {
        runLength += 1;

        if (runLength >= requiredRun) {
          return (
            index +
            requiredRun -
            1
          );
        }
      } else {
        runLength = 0;
      }
    }

    return null;
  }

  #calculateBoundsConfidence(
    left,
    right,
    top,
    bottom,
  ) {
    const detectedValues = [
      left,
      right,
      top,
      bottom,
    ].filter(
      (value) => value !== null,
    ).length;

    return Math.round(
      (detectedValues / 4) * 100,
    );
  }
}
