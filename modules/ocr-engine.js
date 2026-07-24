export class OcrEngine {
  constructor() {
    this.version = "1.0.0";
    this.worker = null;
    this.isInitializing = false;
  }

  async initialize() {
    if (this.worker) {
      return;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await this.#delay(100);
      }

      return;
    }

    if (!window.Tesseract) {
      throw new Error("Tesseract OCR library is not loaded.");
    }

    this.isInitializing = true;

    try {
      this.worker = await window.Tesseract.createWorker("eng");
    } finally {
      this.isInitializing = false;
    }
  }

  async recognize(source) {
    await this.initialize();

    if (!this.worker) {
      throw new Error("OCR worker is unavailable.");
    }

    const result = await this.worker.recognize(source);

    const data = result.data || {};

    return {
      text: data.text || "",
      confidence: Number(data.confidence || 0),

      words: Array.isArray(data.words)
        ? data.words.map((word) => ({
            text: word.text || "",
            confidence: Number(word.confidence || 0),

            x0: Number(word.bbox?.x0 || 0),
            y0: Number(word.bbox?.y0 || 0),
            x1: Number(word.bbox?.x1 || 0),
            y1: Number(word.bbox?.y1 || 0),

            width:
              Number(word.bbox?.x1 || 0) -
              Number(word.bbox?.x0 || 0),

            height:
              Number(word.bbox?.y1 || 0) -
              Number(word.bbox?.y0 || 0),
          }))
        : [],
    };
  }

  async terminate() {
    if (!this.worker) {
      return;
    }

    await this.worker.terminate();
    this.worker = null;
  }

  #delay(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }
}
