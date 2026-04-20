import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useImageUpload } from "../use-image-upload";

// ---------------------------------------------------------------------------
// MockXHR — simulates XMLHttpRequest
// ---------------------------------------------------------------------------

const xhrInstances: MockXHR[] = [];

class MockXHR {
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn();
  status = 200;
  responseText = "";
  upload: { onprogress: ((e: Partial<ProgressEvent>) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    xhrInstances.push(this);
  }
}

// ---------------------------------------------------------------------------
// Mock setup — patch globals before/after each test
// ---------------------------------------------------------------------------

const mockCreateObjectURL = vi.fn();
const mockRevokeObjectURL = vi.fn();

let blobCounter = 0;
let uuidCounter = 0;

beforeEach(() => {
  blobCounter = 0;
  uuidCounter = 0;
  xhrInstances.length = 0;

  mockCreateObjectURL.mockImplementation(() => {
    blobCounter++;
    return `blob:mock-${blobCounter}`;
  });
  mockRevokeObjectURL.mockReset();

  // Patch static methods only — keeps URL as a constructor for jsdom internals
  URL.createObjectURL = mockCreateObjectURL;
  URL.revokeObjectURL = mockRevokeObjectURL;

  vi.stubGlobal("XMLHttpRequest", MockXHR);

  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => {
      uuidCounter++;
      return `uuid-${uuidCounter}`;
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeFile(name = "test.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useImageUpload", () => {
  describe("addImages", () => {
    it("creates pending images with status 'uploading' and progress 0", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      expect(result.current.pendingImages).toHaveLength(1);
      expect(result.current.pendingImages[0].status).toBe("uploading");
      expect(result.current.pendingImages[0].progress).toBe(0);
    });

    it("creates blob URLs via URL.createObjectURL", () => {
      const { result } = renderHook(() => useImageUpload());
      const file = makeFile();

      act(() => {
        result.current.addImages([file]);
      });

      expect(mockCreateObjectURL).toHaveBeenCalledWith(file);
      expect(result.current.pendingImages[0].blobUrl).toBe("blob:mock-1");
    });

    it("opens XHR to POST /api/internal/assistant/images", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      expect(xhr.open).toHaveBeenCalledWith(
        "POST",
        "/api/internal/assistant/images"
      );
    });

    it("sends FormData containing the file via XHR.send", () => {
      const { result } = renderHook(() => useImageUpload());
      const file = makeFile();

      act(() => {
        result.current.addImages([file]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      expect(xhr.send).toHaveBeenCalledWith(expect.any(FormData));
      const formData = xhr.send.mock.calls[0][0] as FormData;
      expect(formData.get("file")).toBe(file);
    });

    it("assigns unique IDs to each image", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile("a.png"), makeFile("b.png")]);
      });

      const ids = result.current.pendingImages.map((i) => i.id);
      expect(new Set(ids).size).toBe(2);
    });
  });

  describe("progress tracking", () => {
    it("updates progress percentage on XHR upload.onprogress", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];

      act(() => {
        xhr.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 100 });
      });

      expect(result.current.pendingImages[0].progress).toBe(50);
    });

    it("does not update progress when lengthComputable is false", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];

      act(() => {
        xhr.upload.onprogress!({ lengthComputable: false, loaded: 50, total: 100 });
      });

      expect(result.current.pendingImages[0].progress).toBe(0);
    });
  });

  describe("upload success", () => {
    it("sets status 'done', progress 100, and filename on 200 with valid JSON", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      xhr.status = 200;
      xhr.responseText = JSON.stringify({ filename: "2026-04/images/test-abc123.png" });

      act(() => {
        xhr.onload!();
      });

      const img = result.current.pendingImages[0];
      expect(img.status).toBe("done");
      expect(img.progress).toBe(100);
      expect(img.filename).toBe("2026-04/images/test-abc123.png");
    });
  });

  describe("upload error — invalid response", () => {
    it("sets status 'error' when 200 response has no filename field", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      xhr.status = 200;
      xhr.responseText = JSON.stringify({ error: "no file" });

      act(() => {
        xhr.onload!();
      });

      expect(result.current.pendingImages[0].status).toBe("error");
    });

    it("sets status 'error' when response body is not valid JSON", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      xhr.status = 200;
      xhr.responseText = "not-json";

      act(() => {
        xhr.onload!();
      });

      expect(result.current.pendingImages[0].status).toBe("error");
    });
  });

  describe("upload error — HTTP error", () => {
    it("sets status 'error' on non-200 HTTP status", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      xhr.status = 500;
      xhr.responseText = "";

      act(() => {
        xhr.onload!();
      });

      expect(result.current.pendingImages[0].status).toBe("error");
    });
  });

  describe("upload error — network", () => {
    it("sets status 'error' on XHR onerror", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];

      act(() => {
        xhr.onerror!();
      });

      expect(result.current.pendingImages[0].status).toBe("error");
    });
  });

  describe("removeImage", () => {
    it("aborts the XHR and revokes the blob URL", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      const id = result.current.pendingImages[0].id;
      const blobUrl = result.current.pendingImages[0].blobUrl;

      act(() => {
        result.current.removeImage(id);
      });

      expect(xhr.abort).toHaveBeenCalledOnce();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith(blobUrl);
    });

    it("removes the image from pendingImages", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const id = result.current.pendingImages[0].id;

      act(() => {
        result.current.removeImage(id);
      });

      expect(result.current.pendingImages).toHaveLength(0);
    });

    it("does not abort XHR when image already completed (XHR removed from map on onload)", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      // Simulate successful upload — onload removes XHR from map
      xhr.status = 200;
      xhr.responseText = JSON.stringify({ filename: "done.png" });
      act(() => {
        xhr.onload!();
      });

      const id = result.current.pendingImages[0].id;
      act(() => {
        result.current.removeImage(id);
      });

      // abort should NOT have been called since XHR was removed from map by onload
      expect(xhr.abort).not.toHaveBeenCalled();
    });
  });

  describe("clearAll", () => {
    it("aborts all XHRs, revokes all blob URLs, and empties pendingImages", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile("a.png"), makeFile("b.png")]);
      });

      expect(result.current.pendingImages).toHaveLength(2);
      const blobUrls = result.current.pendingImages.map((i) => i.blobUrl);
      const createdXhrs = xhrInstances.slice(-2);

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.pendingImages).toHaveLength(0);
      for (const xhr of createdXhrs) {
        expect(xhr.abort).toHaveBeenCalledOnce();
      }
      for (const url of blobUrls) {
        expect(mockRevokeObjectURL).toHaveBeenCalledWith(url);
      }
    });
  });

  describe("hasUploading", () => {
    it("is true when any image has status 'uploading'", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      expect(result.current.hasUploading).toBe(true);
    });

    it("is false when all images have status 'done'", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      xhr.status = 200;
      xhr.responseText = JSON.stringify({ filename: "done.png" });
      act(() => {
        xhr.onload!();
      });

      expect(result.current.hasUploading).toBe(false);
    });

    it("is false when all images have status 'error'", () => {
      const { result } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile()]);
      });

      const xhr = xhrInstances[xhrInstances.length - 1];
      act(() => {
        xhr.onerror!();
      });

      expect(result.current.hasUploading).toBe(false);
    });

    it("is false when pendingImages is empty", () => {
      const { result } = renderHook(() => useImageUpload());

      expect(result.current.hasUploading).toBe(false);
    });
  });

  describe("unmount cleanup", () => {
    it("revokes all blob URLs and aborts all in-flight XHRs on unmount", () => {
      const { result, unmount } = renderHook(() => useImageUpload());

      act(() => {
        result.current.addImages([makeFile("a.png"), makeFile("b.png")]);
      });

      const blobUrls = result.current.pendingImages.map((i) => i.blobUrl);
      const createdXhrs = xhrInstances.slice(-2);

      unmount();

      for (const url of blobUrls) {
        expect(mockRevokeObjectURL).toHaveBeenCalledWith(url);
      }
      for (const xhr of createdXhrs) {
        expect(xhr.abort).toHaveBeenCalledOnce();
      }
    });

    it("does not throw when unmounted with no images", () => {
      const { unmount } = renderHook(() => useImageUpload());

      expect(() => unmount()).not.toThrow();
    });
  });
});
