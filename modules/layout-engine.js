export class LayoutEngine {
  constructor() {
    this.version = "1.1.0";
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

    const reportBounds = this.#detectReportBounds(
      imageData,
      canvas.width,
      canvas.height,
    );

    return {
      pageWidth: canvas.width,
      pageHeight: canvas.height,

      reportBounds,

      verticalColumns: [],
      horizontalRows: [],

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

    context.drawImage(source, 0, 0, width, height);

    return canvas;
  }

  #detectReportBounds(imageData, width, height) {
    const grayscale = this.#createGrayscale(
      imageData.data,
      width,
      height,
    );

    const threshold = this.#calculateThreshold(grayscale);

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
        Math.max(1, width - horizontalMargin * 2);
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
        Math.max(1, height - verticalMargin * 2);
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
      left === null ? fallbackPaddingX : left;

    const safeRight =
      right === null
        ? width - fallbackPaddingX
        : right;

    const safeTop =
      top === null ? fallbackPaddingY : top;

    const safeBottom =
      bottom === null
        ? height - fallbackPaddingY
        : bottom;

    return {
      x: safeLeft,
      y: safeTop,
      width: Math.max(1, safeRight - safeLeft),
      height: Math.max(1, safeBottom - safeTop),
      confidence: this.#calculateBoundsConfidence(
        left,
        right,
        top,
        bottom,
      ),
    };
  }

  #createGrayscale(data, width, height) {
    const grayscale = new Uint8Array(width * height);

    for (
      let pixelIndex = 0, grayIndex = 0;
      pixelIndex < data.length;
      pixelIndex += 4, grayIndex += 1
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
      total / Math.max(1, grayscale.length);

    return Math.max(
      80,
      Math.min(210, mean - 35),
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

    for (let index = start; index < end; index += 1) {
      if (scores[index] >= minimumScore) {
        runLength += 1;

        if (runLength >= requiredRun) {
          return index - requiredRun + 1;
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
          return index + requiredRun - 1;
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
    ].filter((value) => value !== null).length;

    return Math.round(
      (detectedValues / 4) * 100,
    );
  }
}
