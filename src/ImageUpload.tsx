import { useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
import { api } from './api';

export function ImageUpload({
  endpoint = "/admin/media",
  initial = "",
  label,
  required = false,
  onBusy,
}: {
  endpoint?: string;
  initial?: string;
  label: string;
  required?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      onBusy?.(false);
    },
    [],
  );
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 8 * 1024 * 1024
    ) {
      setError("Chọn ảnh JPG, PNG hoặc WebP, tối đa 8 MB.");
      return;
    }
    setBusy(true);
    onBusy?.(true);
    const request = new AbortController();
    controller.current = request;
    try {
      const data = await api<{ url: string }>(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": file.type, "X-App-Request": "keynest" },
        body: file,
        signal: request.signal,
      });
      setUrl(data.url);
    } catch (e) {
      if (!request.signal.aborted) setError((e as Error).message);
    } finally {
      if (!request.signal.aborted) {
        setBusy(false);
        onBusy?.(false);
        if (input.current) input.current.value = "";
      }
    }
  }
  return (
    <div className="image-uploader">
      <span className="field-title">{label}</span>
      <div
        className="image-upload-box"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) upload(e.dataTransfer.files[0]);
        }}
      >
        <div className="image-upload-preview">
          {url ? (
            <img src={url} alt={`Xem trước ${label.toLowerCase()}`} />
          ) : (
            <ImagePlus size={30} />
          )}
        </div>
        <div>
          <strong>
            {busy
              ? "Đang tải ảnh lên…"
              : "Kéo ảnh vào đây hoặc chọn từ thiết bị"}
          </strong>
          <p>JPG, PNG, WebP · Tối đa 8 MB</p>
          <button
            type="button"
            className="button button-outline button-small"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={15} />
            {url ? "Thay ảnh" : "Tải ảnh từ thiết bị"}
          </button>
          {url && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setUrl("")}
            >
              <X size={14} />
              Bỏ ảnh
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        aria-label={`Tải ${label.toLowerCase()} từ thiết bị`}
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <label className="image-url-label">
        Hoặc dùng đường dẫn ảnh
        <input
          name="image"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={600}
          required={required}
          disabled={busy}
          placeholder="Đường dẫn ảnh đã tải lên hoặc Steam CDN"
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <small>
        Ảnh chỉ xuất hiện ngoài cửa hàng sau khi bạn lưu sản phẩm hoặc banner.
      </small>
    </div>
  );
}
