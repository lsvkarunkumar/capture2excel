import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";

const documentInput = document.getElementById("documentInput");
const exportButton = document.getElementById("exportButton");

const previousPageButton = document.getElementById("previousPageButton");
const nextPageButton = document.getElementById("nextPageButton");
const zoomOutButton = document.getElementById("zoomOutButton");
const zoomInButton = document.getElementById("zoomInButton");
const clearSelectionButton = document.getElementById(
  "clearSelectionButton",
);

const autoNextCheckbox = document.getElementById("autoNextCheckbox");
const startPageInput = document.getElementById("startPageInput");
const endPageInput = document.getElementById("endPageInput");
const runRegionButton = document.getElementById("runRegionButton");
const stopRunButton = document.getElementById("stopRunButton");
const runProgress = document.getElementById("runProgress");

const pageIndicator = document.getElementById("pageIndicator");
const emptyState = document.getElementById("emptyState");
const canvasWrapper = document.getElementById("canvasWrapper");
const documentCanvas = document.getElementById("documentCanvas");
const selectionCanvas = document.getElementById("selectionCanvas");
const captureButton = document.getElementById("captureButton");

const captureCount = document.getElementById("captureCount");
const captureList = document.getElementById("captureList");
const clearCapturesButton = document.getElementById(
  "clearCapturesButton",
);

const statusMessage = document.getElementById("statusMessage");

const documentContext = documentCanvas.getContext("2d", {
  willReadFrequently: true,
});

const selectionContext = selectionCanvas.getContext("2d");

let currentDocument = null;
let currentDocumentName = "";
let currentDocumentType = "";
let currentPageNumber = 1;
let currentScale = 1.25;
let totalPages = 0;

let selection = null;
let interactionMode = null;
let dragStart = null;

let isBatchRunning = false;
let stopRequested = false;

let captures = loadCaptures();

const MIN_SELECTION_SIZE = 15;
const HANDLE_SIZE = 10;

documentInput.addEventListener("change", handleDocumentOpen);

previousPageButton.addEventListener("click", async () => {
  if (
    isBatchRunning ||
    !currentDocument ||
    currentPageNumber <= 1
  ) {
    return;
  }

  currentPageNumber -= 1;
  await renderCurrentPage();
});

nextPageButton.addEventListener("click", async () => {
  if (
    isBatchRunning ||
    !currentDocument ||
    currentPageNumber >= totalPages
  ) {
    return;
  }

  currentPageNumber += 1;
  await renderCurrentPage();
});

zoomOutButton.addEventListener("click", async () => {
  if (!currentDocument || isBatchRunning) {
    return;
  }

  currentScale = Math.max(0.5, currentScale - 0.25);

  clearSelection();
  await renderCurrentPage();
});

zoomInButton.addEventListener("click", async () => {
  if (!currentDocument || isBatchRunning) {
    return;
  }

  currentScale = Math.min(3, currentScale + 0.25);

  clearSelection();
  await renderCurrentPage();
});

clearSelectionButton.addEventListener("click", () => {
  if (!isBatchRunning) {
    clearSelection();
  }
});

captureButton.addEventListener("click", handleManualCapture);

clearCapturesButton.addEventListener("click", clearAllCaptures);
exportButton.addEventListener("click", exportCapturesToExcel);

runRegionButton.addEventListener("click", runRegionAcrossPages);

stopRunButton.addEventListener("click", () => {
  if (!isBatchRunning) {
    return;
  }

  stopRequested = true;
  stopRunButton.disabled = true;

  setRunProgress("Stopping after current page…", "stopped");
});

startPageInput.addEventListener("change", validatePageRangeInputs);
endPageInput.addEventListener("change", validatePageRangeInputs);

selectionCanvas.addEventListener("pointerdown", handlePointerDown);
selectionCanvas.addEventListener("pointermove", handlePointerMove);
selectionCanvas.addEventListener("pointerup", handlePointerUp);
selectionCanvas.addEventListener("pointercancel", handlePointerUp);
selectionCanvas.addEventListener("pointerleave", updateSelectionCursor);

renderCaptureList();
updateToolbarState();

async function handleDocumentOpen(event) {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  try {
    await releasePreviousDocument();

    currentDocumentName = file.name;
    currentPageNumber = 1;
    currentScale = 1.25;
    totalPages = 0;

    clearSelection();
    setRunProgress("Opening document…");

    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      currentDocumentType = "pdf";

      const fileBuffer = await file.arrayBuffer();

      currentDocument = await pdfjsLib.getDocument({
        data: fileBuffer,
      }).promise;

      totalPages = currentDocument.numPages;
    } else if (file.type.startsWith("image/")) {
      currentDocumentType = "image";

      const imageUrl = URL.createObjectURL(file);
      const image = await loadImage(imageUrl);

      currentDocument = {
        image,
        imageUrl,
      };

      totalPages = 1;
    } else {
      currentDocument = null;
      currentDocumentType = "";

      showStatus("Unsupported file type.", true);
      setRunProgress("Unsupported file", "stopped");

      return;
    }

    startPageInput.min = "1";
    endPageInput.min = "1";

    startPageInput.max = String(totalPages);
    endPageInput.max = String(totalPages);

    startPageInput.value = "1";
    endPageInput.value = String(totalPages);

    emptyState.classList.add("hidden");
    canvasWrapper.classList.remove("hidden");

    await renderCurrentPage();

    setRunProgress("Ready");
    showStatus(`Opened ${currentDocumentName}`);
  } catch (error) {
    console.error(error);

    currentDocument = null;
    currentDocumentType = "";
    totalPages = 0;

    showStatus("The document could not be opened.", true);
    setRunProgress("Open failed", "stopped");
  } finally {
    documentInput.value = "";
    updateToolbarState();
  }
}

async function releasePreviousDocument() {
  if (
    currentDocumentType === "image" &&
    currentDocument?.imageUrl
  ) {
    URL.revokeObjectURL(currentDocument.imageUrl);
  }

  if (
    currentDocumentType === "pdf" &&
    typeof currentDocument?.destroy === "function"
  ) {
    try {
      await currentDocument.destroy();
    } catch {
      // Ignore PDF cleanup failures.
    }
  }
}

async function renderCurrentPage() {
  if (!currentDocument) {
    return;
  }

  try {
    if (currentDocumentType === "pdf") {
      await renderPdfPage();
    } else {
      renderImagePage();
    }

    if (selection) {
      constrainSelection();
      drawSelection();
    } else {
      clearSelectionOverlay();
      captureButton.classList.add("hidden");
    }

    updateToolbarState();
  } catch (error) {
    console.error(error);
    showStatus("The page could not be rendered.", true);

    throw error;
  }
}

async function renderPdfPage() {
  const page = await currentDocument.getPage(currentPageNumber);

  const viewport = page.getViewport({
    scale: currentScale,
  });

  resizeCanvases(viewport.width, viewport.height);

  documentContext.clearRect(
    0,
    0,
    documentCanvas.width,
    documentCanvas.height,
  );

  await page.render({
    canvasContext: documentContext,
    viewport,
  }).promise;

  pageIndicator.textContent =
    `${currentDocumentName} · Page ${currentPageNumber} of ${totalPages}`;
}

function renderImagePage() {
  const image = currentDocument.image;

  const width = image.naturalWidth * currentScale;
  const height = image.naturalHeight * currentScale;

  resizeCanvases(width, height);

  documentContext.clearRect(
    0,
    0,
    documentCanvas.width,
    documentCanvas.height,
  );

  documentContext.drawImage(
    image,
    0,
    0,
    documentCanvas.width,
    documentCanvas.height,
  );

  pageIndicator.textContent = `${currentDocumentName} · Image`;
}

function resizeCanvases(width, height) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  documentCanvas.width = safeWidth;
  documentCanvas.height = safeHeight;

  selectionCanvas.width = safeWidth;
  selectionCanvas.height = safeHeight;

  canvasWrapper.style.width = `${safeWidth}px`;
  canvasWrapper.style.height = `${safeHeight}px`;
}

function updateToolbarState() {
  const hasDocument = Boolean(currentDocument);
  const hasSelection = Boolean(selection);

  documentInput.disabled = isBatchRunning;

  previousPageButton.disabled =
    isBatchRunning ||
    !hasDocument ||
    currentPageNumber <= 1;

  nextPageButton.disabled =
    isBatchRunning ||
    !hasDocument ||
    currentPageNumber >= totalPages;

  zoomOutButton.disabled =
    isBatchRunning ||
    !hasDocument ||
    currentScale <= 0.5;

  zoomInButton.disabled =
    isBatchRunning ||
    !hasDocument ||
    currentScale >= 3;

  clearSelectionButton.disabled =
    isBatchRunning || !hasSelection;

  startPageInput.disabled =
    isBatchRunning || !hasDocument;

  endPageInput.disabled =
    isBatchRunning || !hasDocument;

  autoNextCheckbox.disabled = isBatchRunning;

  runRegionButton.disabled =
    isBatchRunning ||
    !hasDocument ||
    !hasSelection;

  stopRunButton.disabled = !isBatchRunning;

  captureButton.disabled = isBatchRunning;

  clearCapturesButton.disabled =
    isBatchRunning || captures.length === 0;

  exportButton.disabled =
    isBatchRunning || captures.length === 0;

  selectionCanvas.style.pointerEvents =
    isBatchRunning ? "none" : "auto";
}

function handlePointerDown(event) {
  if (!currentDocument || isBatchRunning) {
    return;
  }

  const point = getCanvasPoint(event);
  const handle = getResizeHandle(point);

  selectionCanvas.setPointerCapture(event.pointerId);

  if (handle) {
    interactionMode = `resize-${handle}`;

    dragStart = {
      x: point.x,
      y: point.y,
      selection: { ...selection },
    };

    return;
  }

  if (selection && isPointInsideSelection(point)) {
    interactionMode = "move";

    dragStart = {
      x: point.x,
      y: point.y,
      selection: { ...selection },
    };

    return;
  }

  interactionMode = "draw";
  dragStart = point;

  selection = {
    x: point.x,
    y: point.y,
    width: 0,
    height: 0,
  };

  drawSelection();
}

function handlePointerMove(event) {
  if (isBatchRunning) {
    return;
  }

  if (!interactionMode || !dragStart) {
    updateSelectionCursor(event);
    return;
  }

  const point = getCanvasPoint(event);

  if (interactionMode === "draw") {
    selection = normalizeRectangle(
      dragStart.x,
      dragStart.y,
      point.x,
      point.y,
    );
  }

  if (interactionMode === "move") {
    const offsetX = point.x - dragStart.x;
    const offsetY = point.y - dragStart.y;

    selection = {
      ...dragStart.selection,

      x: clamp(
        dragStart.selection.x + offsetX,
        0,
        selectionCanvas.width -
          dragStart.selection.width,
      ),

      y: clamp(
        dragStart.selection.y + offsetY,
        0,
        selectionCanvas.height -
          dragStart.selection.height,
      ),
    };
  }

  if (interactionMode.startsWith("resize-")) {
    resizeSelection(
      interactionMode.replace("resize-", ""),
      point,
    );
  }

  drawSelection();
}

function handlePointerUp(event) {
  if (!interactionMode || isBatchRunning) {
    return;
  }

  try {
    selectionCanvas.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer may already be released.
  }

  interactionMode = null;
  dragStart = null;

  if (
    !selection ||
    selection.width < MIN_SELECTION_SIZE ||
    selection.height < MIN_SELECTION_SIZE
  ) {
    clearSelection();
    return;
  }

  constrainSelection();
  drawSelection();
  updateToolbarState();
}

function resizeSelection(handle, point) {
  const original = dragStart.selection;

  let left = original.x;
  let top = original.y;
  let right = original.x + original.width;
  let bottom = original.y + original.height;

  if (handle.includes("w")) {
    left = point.x;
  }

  if (handle.includes("e")) {
    right = point.x;
  }

  if (handle.includes("n")) {
    top = point.y;
  }

  if (handle.includes("s")) {
    bottom = point.y;
  }

  selection = normalizeRectangle(left, top, right, bottom);
  constrainSelection();
}

function constrainSelection() {
  if (!selection) {
    return;
  }

  if (
    selectionCanvas.width < MIN_SELECTION_SIZE ||
    selectionCanvas.height < MIN_SELECTION_SIZE
  ) {
    clearSelection();
    return;
  }

  selection.x = clamp(
    selection.x,
    0,
    selectionCanvas.width - MIN_SELECTION_SIZE,
  );

  selection.y = clamp(
    selection.y,
    0,
    selectionCanvas.height - MIN_SELECTION_SIZE,
  );

  selection.width = clamp(
    selection.width,
    MIN_SELECTION_SIZE,
    selectionCanvas.width - selection.x,
  );

  selection.height = clamp(
    selection.height,
    MIN_SELECTION_SIZE,
    selectionCanvas.height - selection.y,
  );
}

function drawSelection() {
  clearSelectionOverlay();

  if (!selection) {
    captureButton.classList.add("hidden");
    updateToolbarState();
    return;
  }

  selectionContext.save();

  selectionContext.fillStyle = "rgba(45, 103, 246, 0.12)";
  selectionContext.strokeStyle = "#2d67f6";
  selectionContext.lineWidth = 2;
  selectionContext.setLineDash([8, 5]);

  selectionContext.fillRect(
    selection.x,
    selection.y,
    selection.width,
    selection.height,
  );

  selectionContext.strokeRect(
    selection.x,
    selection.y,
    selection.width,
    selection.height,
  );

  selectionContext.setLineDash([]);

  drawResizeHandles();

  selectionContext.restore();

  positionCaptureButton();
  updateToolbarState();
}

function clearSelectionOverlay() {
  selectionContext.clearRect(
    0,
    0,
    selectionCanvas.width,
    selectionCanvas.height,
  );
}

function drawResizeHandles() {
  const handles = getHandlePositions();

  selectionContext.fillStyle = "#ffffff";
  selectionContext.strokeStyle = "#2d67f6";
  selectionContext.lineWidth = 2;

  Object.values(handles).forEach((point) => {
    selectionContext.fillRect(
      point.x - HANDLE_SIZE / 2,
      point.y - HANDLE_SIZE / 2,
      HANDLE_SIZE,
      HANDLE_SIZE,
    );

    selectionContext.strokeRect(
      point.x - HANDLE_SIZE / 2,
      point.y - HANDLE_SIZE / 2,
      HANDLE_SIZE,
      HANDLE_SIZE,
    );
  });
}

function getHandlePositions() {
  if (!selection) {
    return {};
  }

  const left = selection.x;
  const right = selection.x + selection.width;
  const top = selection.y;
  const bottom = selection.y + selection.height;
  const centerX = left + selection.width / 2;
  const centerY = top + selection.height / 2;

  return {
    nw: { x: left, y: top },
    n: { x: centerX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: centerY },
    se: { x: right, y: bottom },
    s: { x: centerX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: centerY },
  };
}

function getResizeHandle(point) {
  if (!selection) {
    return null;
  }

  const handles = getHandlePositions();
  const tolerance = HANDLE_SIZE + 5;

  return (
    Object.entries(handles).find(([, handlePoint]) => {
      return (
        Math.abs(point.x - handlePoint.x) <= tolerance &&
        Math.abs(point.y - handlePoint.y) <= tolerance
      );
    })?.[0] ?? null
  );
}

function updateSelectionCursor(event) {
  if (isBatchRunning) {
    selectionCanvas.style.cursor = "wait";
    return;
  }

  if (!selection) {
    selectionCanvas.style.cursor = "crosshair";
    return;
  }

  const point = getCanvasPoint(event);
  const handle = getResizeHandle(point);

  const cursors = {
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
  };

  if (handle) {
    selectionCanvas.style.cursor = cursors[handle];
  } else if (isPointInsideSelection(point)) {
    selectionCanvas.style.cursor = "move";
  } else {
    selectionCanvas.style.cursor = "crosshair";
  }
}

function isPointInsideSelection(point) {
  return (
    selection &&
    point.x >= selection.x &&
    point.x <= selection.x + selection.width &&
    point.y >= selection.y &&
    point.y <= selection.y + selection.height
  );
}

function positionCaptureButton() {
  if (!selection) {
    captureButton.classList.add("hidden");
    return;
  }

  const buttonWidth = 92;
  const buttonHeight = 38;
  const gap = 10;

  let left = selection.x + selection.width + gap;
  let top = selection.y;

  if (left + buttonWidth > selectionCanvas.width) {
    left = Math.max(
      0,
      selection.x + selection.width - buttonWidth,
    );

    top = selection.y + selection.height + gap;
  }

  if (top + buttonHeight > selectionCanvas.height) {
    top = Math.max(
      0,
      selection.y - buttonHeight - gap,
    );
  }

  captureButton.style.left = `${left}px`;
  captureButton.style.top = `${top}px`;
  captureButton.classList.remove("hidden");
}

function clearSelection() {
  selection = null;
  interactionMode = null;
  dragStart = null;

  clearSelectionOverlay();

  captureButton.classList.add("hidden");
  selectionCanvas.style.cursor = "crosshair";

  updateToolbarState();
}

async function handleManualCapture() {
  if (
    !selection ||
    !currentDocument ||
    isBatchRunning
  ) {
    return;
  }

  const capture = saveCurrentPageCapture();

  if (!capture) {
    return;
  }

  showStatus(
    `${capture.name} saved from page ${currentPageNumber}.`,
  );

  if (
    autoNextCheckbox.checked &&
    currentPageNumber < totalPages
  ) {
    currentPageNumber += 1;

    await renderCurrentPage();

    setRunProgress(
      `Page ${currentPageNumber} ready`,
    );
  } else if (
    autoNextCheckbox.checked &&
    currentPageNumber >= totalPages
  ) {
    setRunProgress("Last page reached", "complete");
  }
}

function saveCurrentPageCapture(options = {}) {
  const {
    silent = false,
    batchId = "",
    batchStartPage = null,
    batchEndPage = null,
  } = options;

  if (!selection || !currentDocument) {
    if (!silent) {
      showStatus("Draw a capture box first.", true);
    }

    return null;
  }

  constrainSelection();

  if (!selection) {
    return null;
  }

  const captureCanvas = document.createElement("canvas");

  captureCanvas.width = Math.max(
    1,
    Math.round(selection.width),
  );

  captureCanvas.height = Math.max(
    1,
    Math.round(selection.height),
  );

  const captureContext = captureCanvas.getContext("2d");

  if (!captureContext) {
    if (!silent) {
      showStatus(
        "The selected area could not be captured.",
        true,
      );
    }

    return null;
  }

  captureContext.drawImage(
    documentCanvas,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    0,
    0,
    captureCanvas.width,
    captureCanvas.height,
  );

  const captureNumber = captures.length + 1;

  const capture = {
    id: createId(),

    name:
      `Capture ${String(captureNumber).padStart(3, "0")}`,

    type: "auto",
    group: batchId ? `Batch ${batchId}` : "",
    notes: "",

    imageDataUrl: captureCanvas.toDataURL("image/png"),

    documentName: currentDocumentName,
    pageNumber: currentPageNumber,

    coordinates: {
      x: Math.round(selection.x),
      y: Math.round(selection.y),
      width: Math.round(selection.width),
      height: Math.round(selection.height),
    },

    scale: currentScale,

    batchId,
    batchStartPage,
    batchEndPage,

    createdAt: new Date().toISOString(),
  };

  captures.push(capture);

  saveCaptures();
  renderCaptureList();

  return capture;
}

async function runRegionAcrossPages() {
  if (
    !currentDocument ||
    !selection ||
    isBatchRunning
  ) {
    return;
  }

  validatePageRangeInputs();

  const startPage = Number.parseInt(
    startPageInput.value,
    10,
  );

  const endPage = Number.parseInt(
    endPageInput.value,
    10,
  );

  if (
    !Number.isInteger(startPage) ||
    !Number.isInteger(endPage)
  ) {
    showStatus("Enter a valid page range.", true);
    return;
  }

  if (
    startPage < 1 ||
    endPage > totalPages ||
    startPage > endPage
  ) {
    showStatus(
      `Page range must be between 1 and ${totalPages}.`,
      true,
    );

    return;
  }

  const totalToCapture = endPage - startPage + 1;

  const confirmed = window.confirm(
    `Capture the selected region from ${totalToCapture} page${
      totalToCapture === 1 ? "" : "s"
    }?\n\nPages ${startPage} to ${endPage}`,
  );

  if (!confirmed) {
    return;
  }

  isBatchRunning = true;
  stopRequested = false;

  const batchId = createBatchId();
  let completedCount = 0;
  let failedCount = 0;

  updateToolbarState();

  setRunProgress(
    `Starting pages ${startPage}–${endPage}…`,
    "running",
  );

  try {
    for (
      let pageNumber = startPage;
      pageNumber <= endPage;
      pageNumber += 1
    ) {
      if (stopRequested) {
        break;
      }

      currentPageNumber = pageNumber;

      setRunProgress(
        `Rendering page ${pageNumber} of ${endPage}`,
        "running",
      );

      try {
        await renderCurrentPage();
        await waitForBrowserPaint();

        if (stopRequested) {
          break;
        }

        const capture = saveCurrentPageCapture({
          silent: true,
          batchId,
          batchStartPage: startPage,
          batchEndPage: endPage,
        });

        if (capture) {
          completedCount += 1;
        } else {
          failedCount += 1;
        }
      } catch (error) {
        console.error(
          `Page ${pageNumber} batch capture failed.`,
          error,
        );

        failedCount += 1;
      }

      setRunProgress(
        `Captured ${completedCount} of ${totalToCapture}`,
        "running",
      );

      await delay(40);
    }

    if (stopRequested) {
      setRunProgress(
        `Stopped · ${completedCount} captured`,
        "stopped",
      );

      showStatus(
        `Batch stopped. ${completedCount} page${
          completedCount === 1 ? "" : "s"
        } captured.`,
      );
    } else {
      const failureText =
        failedCount > 0
          ? ` · ${failedCount} failed`
          : "";

      setRunProgress(
        `Complete · ${completedCount} captured${failureText}`,
        "complete",
      );

      showStatus(
        `Batch complete. ${completedCount} page${
          completedCount === 1 ? "" : "s"
        } captured.`,
        failedCount > 0,
      );
    }
  } finally {
    isBatchRunning = false;
    stopRequested = false;

    updateToolbarState();
    drawSelection();
  }
}

function validatePageRangeInputs() {
  if (!currentDocument || totalPages < 1) {
    return;
  }

  let startPage = Number.parseInt(
    startPageInput.value,
    10,
  );

  let endPage = Number.parseInt(
    endPageInput.value,
    10,
  );

  if (!Number.isInteger(startPage)) {
    startPage = 1;
  }

  if (!Number.isInteger(endPage)) {
    endPage = totalPages;
  }

  startPage = clamp(startPage, 1, totalPages);
  endPage = clamp(endPage, 1, totalPages);

  if (startPage > endPage) {
    if (document.activeElement === startPageInput) {
      endPage = startPage;
    } else {
      startPage = endPage;
    }
  }

  startPageInput.value = String(startPage);
  endPageInput.value = String(endPage);
}

function setRunProgress(message, state = "") {
  runProgress.textContent = message;

  runProgress.classList.remove(
    "running",
    "stopped",
    "complete",
  );

  if (state) {
    runProgress.classList.add(state);
  }
}

function renderCaptureList() {
  captureCount.textContent =
    `${captures.length} ${
      captures.length === 1 ? "capture" : "captures"
    }`;

  exportButton.disabled =
    isBatchRunning || captures.length === 0;

  clearCapturesButton.disabled =
    isBatchRunning || captures.length === 0;

  if (captures.length === 0) {
    captureList.innerHTML = `
      <div class="capture-empty-state">
        Captured regions will appear here.
      </div>
    `;

    updateToolbarState();
    return;
  }

  captureList.innerHTML = "";

  captures
    .slice()
    .reverse()
    .forEach((capture) => {
      const card = document.createElement("article");
      card.className = "capture-card";

      const image = document.createElement("img");
      image.className = "capture-thumbnail";
      image.src = capture.imageDataUrl;
      image.alt = capture.name;

      const content = document.createElement("div");
      content.className = "capture-card-content";

      const title = document.createElement("h3");
      title.textContent = capture.name;

      const meta = document.createElement("p");
      meta.className = "capture-meta";

      meta.textContent =
        `${capture.documentName} · Page ${capture.pageNumber}`;

      const type = document.createElement("span");
      type.className = "capture-type";

      type.textContent =
        capture.batchId
          ? `Batch ${capture.batchId}`
          : capture.type || "auto";

      const actions = document.createElement("div");
      actions.className = "capture-card-actions";

      const downloadButton =
        document.createElement("button");

      downloadButton.type = "button";
      downloadButton.textContent = "Download Image";

      downloadButton.addEventListener("click", () => {
        downloadDataUrl(
          capture.imageDataUrl,
          `${sanitizeFilename(capture.name)}.png`,
        );
      });

      const deleteButton =
        document.createElement("button");

      deleteButton.type = "button";
      deleteButton.className = "delete-button";
      deleteButton.textContent = "Delete";

      deleteButton.addEventListener("click", () => {
        deleteCapture(capture.id);
      });

      actions.append(downloadButton, deleteButton);
      content.append(title, meta, type, actions);
      card.append(image, content);

      captureList.append(card);
    });

  updateToolbarState();
}

function deleteCapture(captureId) {
  if (isBatchRunning) {
    return;
  }

  captures = captures.filter(
    (capture) => capture.id !== captureId,
  );

  saveCaptures();
  renderCaptureList();

  showStatus("Capture deleted.");
}

function clearAllCaptures() {
  if (isBatchRunning) {
    return;
  }

  const confirmed = window.confirm(
    "Delete all saved captures from this browser?",
  );

  if (!confirmed) {
    return;
  }

  captures = [];

  saveCaptures();
  renderCaptureList();

  setRunProgress("Ready");
  showStatus("Captured Items panel cleared.");
}

async function exportCapturesToExcel() {
  if (
    captures.length === 0 ||
    isBatchRunning
  ) {
    return;
  }

  if (!window.ExcelJS) {
    showStatus("Excel library is not available.", true);
    return;
  }

  try {
    exportButton.disabled = true;
    exportButton.textContent = "Generating…";

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "Capture2Excel";
    workbook.created = new Date();

    const indexSheet =
      workbook.addWorksheet("Capture Index");

    indexSheet.columns = [
      {
        header: "Capture ID",
        key: "captureId",
        width: 24,
      },
      {
        header: "Capture Name",
        key: "captureName",
        width: 24,
      },
      {
        header: "Document",
        key: "document",
        width: 30,
      },
      {
        header: "Page",
        key: "page",
        width: 10,
      },
      {
        header: "Type",
        key: "type",
        width: 14,
      },
      {
        header: "Group",
        key: "group",
        width: 22,
      },
      {
        header: "Batch ID",
        key: "batchId",
        width: 16,
      },
      {
        header: "Batch Start Page",
        key: "batchStartPage",
        width: 18,
      },
      {
        header: "Batch End Page",
        key: "batchEndPage",
        width: 18,
      },
      {
        header: "Notes",
        key: "notes",
        width: 35,
      },
      {
        header: "Captured At",
        key: "capturedAt",
        width: 22,
      },
      {
        header: "X",
        key: "x",
        width: 10,
      },
      {
        header: "Y",
        key: "y",
        width: 10,
      },
      {
        header: "Width",
        key: "width",
        width: 12,
      },
      {
        header: "Height",
        key: "height",
        width: 12,
      },
    ];

    captures.forEach((capture) => {
      indexSheet.addRow({
        captureId: capture.id,
        captureName: capture.name,
        document: capture.documentName,
        page: capture.pageNumber,
        type: capture.type || "auto",
        group: capture.group || "",
        batchId: capture.batchId || "",
        batchStartPage:
          capture.batchStartPage ?? "",
        batchEndPage:
          capture.batchEndPage ?? "",
        notes: capture.notes || "",
        capturedAt: new Date(capture.createdAt),
        x: capture.coordinates.x,
        y: capture.coordinates.y,
        width: capture.coordinates.width,
        height: capture.coordinates.height,
      });
    });

    styleHeaderRow(indexSheet);

    const imagesSheet =
      workbook.addWorksheet("Source Images");

    imagesSheet.columns = [
      {
        header: "Capture",
        key: "capture",
        width: 26,
      },
      {
        header: "Document",
        key: "document",
        width: 30,
      },
      {
        header: "Page",
        key: "page",
        width: 10,
      },
      {
        header: "Type",
        key: "type",
        width: 14,
      },
      {
        header: "Group",
        key: "group",
        width: 22,
      },
      {
        header: "Batch ID",
        key: "batchId",
        width: 16,
      },
      {
        header: "Image",
        key: "image",
        width: 70,
      },
    ];

    styleHeaderRow(imagesSheet);

    let rowNumber = 2;

    for (const capture of captures) {
      imagesSheet.getRow(rowNumber).height = 130;

      imagesSheet.getCell(`A${rowNumber}`).value =
        capture.name;

      imagesSheet.getCell(`B${rowNumber}`).value =
        capture.documentName;

      imagesSheet.getCell(`C${rowNumber}`).value =
        capture.pageNumber;

      imagesSheet.getCell(`D${rowNumber}`).value =
        capture.type || "auto";

      imagesSheet.getCell(`E${rowNumber}`).value =
        capture.group || "";

      imagesSheet.getCell(`F${rowNumber}`).value =
        capture.batchId || "";

      const base64 =
        capture.imageDataUrl.split(",")[1];

      const imageId = workbook.addImage({
        base64,
        extension: "png",
      });

      imagesSheet.addImage(imageId, {
        tl: {
          col: 6,
          row: rowNumber - 1,
        },

        ext: {
          width: 500,
          height: 160,
        },

        editAs: "oneCell",
      });

      rowNumber += 1;
    }

    const buffer =
      await workbook.xlsx.writeBuffer();

    const blob = new Blob([buffer], {
      type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    downloadBlob(
      blob,
      `Capture2Excel_${formatTimestampForFilename()}.xlsx`,
    );

    showStatus("Excel workbook generated.");
  } catch (error) {
    console.error(error);
    showStatus("Excel export failed.", true);
  } finally {
    exportButton.textContent = "Export Excel";
    updateToolbarState();
  }
}

function styleHeaderRow(sheet) {
  const headerRow = sheet.getRow(1);

  headerRow.font = {
    bold: true,

    color: {
      argb: "FFFFFFFF",
    },
  };

  headerRow.fill = {
    type: "pattern",
    pattern: "solid",

    fgColor: {
      argb: "FF172033",
    },
  };

  headerRow.alignment = {
    vertical: "middle",
  };

  headerRow.height = 24;

  sheet.views = [
    {
      state: "frozen",
      ySplit: 1,
    },
  ];

  sheet.autoFilter = {
    from: {
      row: 1,
      column: 1,
    },

    to: {
      row: 1,
      column: sheet.columnCount,
    },
  };
}

function loadCaptures() {
  try {
    const storedValue =
      localStorage.getItem(
        "capture2excel-captures",
      );

    if (!storedValue) {
      return [];
    }

    const parsedValue = JSON.parse(storedValue);

    return Array.isArray(parsedValue)
      ? parsedValue
      : [];
  } catch {
    return [];
  }
}

function saveCaptures() {
  try {
    localStorage.setItem(
      "capture2excel-captures",
      JSON.stringify(captures),
    );
  } catch (error) {
    console.error(error);

    showStatus(
      "Browser storage is full. Export or delete older captures.",
      true,
    );
  }
}

function getCanvasPoint(event) {
  const rectangle =
    selectionCanvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rectangle.left) *
      (selectionCanvas.width / rectangle.width),

    y:
      (event.clientY - rectangle.top) *
      (selectionCanvas.height / rectangle.height),
  };
}

function normalizeRectangle(
  startX,
  startY,
  endX,
  endY,
) {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(
    Math.max(value, minimum),
    maximum,
  );
}

function createId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return (
    `${Date.now()}-` +
    Math.random().toString(16).slice(2)
  );
}

function createBatchId() {
  const now = new Date();

  const hours =
    String(now.getHours()).padStart(2, "0");

  const minutes =
    String(now.getMinutes()).padStart(2, "0");

  const seconds =
    String(now.getSeconds()).padStart(2, "0");

  return `${hours}${minutes}${seconds}`;
}

function sanitizeFilename(value) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .trim()
    .slice(0, 100);
}

function formatTimestampForFilename() {
  const now = new Date();

  const year = now.getFullYear();

  const month =
    String(now.getMonth() + 1).padStart(2, "0");

  const day =
    String(now.getDate()).padStart(2, "0");

  const hours =
    String(now.getHours()).padStart(2, "0");

  const minutes =
    String(now.getMinutes()).padStart(2, "0");

  return `${year}${month}${day}_${hours}${minutes}`;
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement("a");

  link.href = dataUrl;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function waitForBrowserPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

let statusTimeout = null;

function showStatus(message, isError = false) {
  window.clearTimeout(statusTimeout);

  statusMessage.textContent = message;
  statusMessage.classList.toggle(
    "error",
    isError,
  );

  statusMessage.classList.remove("hidden");

  statusTimeout = window.setTimeout(() => {
    statusMessage.classList.add("hidden");
  }, 3500);
}
