import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useStore } from "./App";
import { api } from "./api";
import type { User } from "./types";
import { AvatarCrop } from "./AvatarCrop";

export function AvatarUpload() {
  const { setUser, notify, mode } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<File>();
  function select(file?: File) {
    if (!file || busy) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 4 * 1024 * 1024
    ) {
      setError("Chọn ảnh JPG, PNG hoặc WebP, tối đa 4 MB.");
      return;
    }
    setSelected(file);
  }
  async function upload(file: Blob) {
    setBusy(true);
    setError("");
    try {
      const user = await api<User>("/me/avatar", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setUser(user);
      setSelected(undefined);
      notify("Đã cập nhật ảnh đại diện.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        className="button button-outline button-small"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Upload size={16} />
        {busy ? "Đang lưu ảnh…" : "Thay ảnh đại diện"}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        aria-label="Chọn ảnh đại diện"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          select(file);
        }}
      />
      <p className="muted">
        JPG, PNG, WebP · Tối đa 4 MB · Căn chỉnh và xem trước khi lưu.
        {mode === "demo" ? " Bản demo lưu ảnh trên máy chủ cục bộ." : ""}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {selected && (
        <AvatarCrop
          file={selected}
          busy={busy}
          error={error}
          save={upload}
          close={() => {
            setSelected(undefined);
            setError("");
          }}
        />
      )}
    </div>
  );
}
