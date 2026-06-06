type CanvasModule = {
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
};

type PdfParseModule = {
  PDFParse: new (options: { data: Uint8Array }) => {
    getText: (options?: Record<string, unknown>) => Promise<{ text: string }>;
    destroy: () => Promise<void>;
  };
};

let runtimeReady = false;

async function ensureCanvasPolyfills() {
  if (runtimeReady) {
    return;
  }

  try {
    const canvas = (await import("@napi-rs/canvas")) as unknown as CanvasModule;
    if (!globalThis.DOMMatrix && canvas.DOMMatrix) {
      globalThis.DOMMatrix = canvas.DOMMatrix as typeof globalThis.DOMMatrix;
    }
    if (!globalThis.ImageData && canvas.ImageData) {
      globalThis.ImageData = canvas.ImageData as typeof globalThis.ImageData;
    }
    if (!globalThis.Path2D && canvas.Path2D) {
      globalThis.Path2D = canvas.Path2D as typeof globalThis.Path2D;
    }
  } catch {
    // Leave globals untouched and let the downstream parser surface a clear error if needed.
  }

  runtimeReady = true;
}

export async function loadPdfParse() {
  await ensureCanvasPolyfills();
  return (await import("pdf-parse")) as PdfParseModule;
}
