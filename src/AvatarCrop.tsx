import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "./App";
import "./avatar-crop.css";

export function AvatarCrop({
  file,
  busy,
  error,
  close,
  save,
}: {
  file: File;
  busy: boolean;
  error: string;
  close: () => void;
  save: (blob: Blob) => Promise<void>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement>();
  const [loadError, setLoadError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 50, y: 50 });
  const [exporting, setExporting] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const locked = busy || exporting;
  useEffect(() => {
    const url = URL.createObjectURL(file);
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      if (img.naturalWidth * img.naturalHeight > 24_000_000) {
        setLoadError("Chọn ảnh có độ phân giải tối đa 24 megapixel.");
      } else setImage(img);
    };
    img.onerror = () => {
      if (!cancelled)
        setLoadError("Không đọc được ảnh. Vui lòng chọn ảnh khác.");
    };
    img.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  const side = image
    ? Math.min(image.naturalWidth, image.naturalHeight) / zoom
    : 0;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !image) return;
    ctx.clearRect(0, 0, 512, 512);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      ((image.naturalWidth - side) * position.x) / 100,
      ((image.naturalHeight - side) * position.y) / 100,
      side,
      side,
      0,
      0,
      512,
      512,
    );
  }, [image, side, position]);
  async function confirm() {
    if (!canvas.current || !image || locked) return;
    setExporting(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.current!.toBlob(resolve, "image/webp", 0.92),
      );
      if (!blob) throw new Error("Không thể xử lý ảnh. Hãy chọn lại ảnh.");
      await save(blob);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return createPortal(
    <Modal
      title="Chỉnh ảnh đại diện"
      close={() => {
        if (!locked) close();
      }}
      className="avatar-crop-modal"
    >
      <p className="muted">
        Kéo ảnh để căn chỉnh, phóng to để chọn phần muốn giữ.
      </p>
      <div
        className="avatar-crop-stage"
        onPointerDown={(e) => {
          if (!image || locked) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!drag.current || !image || locked) return;
          const scale = side / e.currentTarget.getBoundingClientRect().width;
          const dx = (e.clientX - drag.current.x) * scale;
          const dy = (e.clientY - drag.current.y) * scale;
          drag.current = { x: e.clientX, y: e.clientY };
          setPosition((p) => ({
            x: Math.max(
              0,
              Math.min(
                100,
                p.x - (dx / (image.naturalWidth - side || 1)) * 100,
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                100,
                p.y - (dy / (image.naturalHeight - side || 1)) * 100,
              ),
            ),
          }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <canvas
          ref={canvas}
          width={512}
          height={512}
          aria-label="Ảnh đại diện sau khi cắt"
          role="img"
        />
        <span className="avatar-crop-mask" aria-hidden="true" />
      </div>
      <fieldset disabled={locked || !image} className="avatar-crop-controls">
        <label>
          Phóng to <span>{zoom.toFixed(1)}×</span>
          <input
            aria-label="Phóng to"
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <label>
          Vị trí ngang
          <input
            aria-label="Vị trí ngang"
            type="range"
            min="0"
            max="100"
            value={position.x}
            onChange={(e) =>
              setPosition((p) => ({ ...p, x: Number(e.target.value) }))
            }
          />
        </label>
        <label>
          Vị trí dọc
          <input
            aria-label="Vị trí dọc"
            type="range"
            min="0"
            max="100"
            value={position.y}
            onChange={(e) =>
              setPosition((p) => ({ ...p, y: Number(e.target.value) }))
            }
          />
        </label>
        <button
          type="button"
          className="button button-outline button-small"
          onClick={() => {
            setZoom(1);
            setPosition({ x: 50, y: 50 });
          }}
        >
          Đặt lại
        </button>
      </fieldset>
      {(loadError || error) && (
        <p className="form-error" role="alert">
          {loadError || error}
        </p>
      )}
      <div className="avatar-crop-actions">
        <button
          type="button"
          className="button button-outline"
          disabled={locked}
          onClick={close}
        >
          Hủy
        </button>
        <button
          type="button"
          className="button"
          disabled={locked || !image || !!loadError}
          onClick={() => void confirm()}
        >
          {locked ? "Đang lưu…" : "Lưu ảnh đại diện"}
        </button>
      </div>
    </Modal>,
    document.body,
  );
}
