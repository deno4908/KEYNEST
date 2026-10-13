import { useState } from "react";
import type { FormEvent } from "react";
import { Check, KeyRound } from "lucide-react";
import { post } from "./api";

export function ChangePassword({ locked = false }: { locked?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setError("");
    setMessage("");
    if (values.password !== values.password_confirmation) {
      setError("Mật khẩu nhập lại chưa khớp.");
      return;
    }
    setBusy(true);
    try {
      const result = await post<{ message: string }>("/me/password", values);
      form.reset();
      setMessage(result.message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (locked)
    return (
      <div className="member-security-row">
        <span className="member-security-icon">
          <KeyRound size={22} />
        </span>
        <div>
          <h3>Đổi mật khẩu</h3>
          <p>
            Không khả dụng với phiên đăng nhập Google hoặc Discord. Quản lý mật
            khẩu trong phần bảo mật của tài khoản Google/Discord.
          </p>
        </div>
      </div>
    );
  return (
    <form className="member-form member-password-form" onSubmit={submit}>
      <h3>
        <KeyRound size={18} aria-hidden="true" /> Đổi mật khẩu
      </h3>
      <p>Dùng ít nhất 10 ký tự, có chữ hoa, chữ thường và số.</p>
      <p>Không dùng lại mật khẩu hiện tại hoặc mật khẩu đã dùng trong 30 ngày qua.</p>
      <div>
        <label htmlFor="current-password">Mật khẩu hiện tại</label>
        <input
          id="current-password"
          name="current_password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          disabled={busy}
        />
      </div>
      <div>
        <label htmlFor="new-password">Mật khẩu mới</label>
        <input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          disabled={busy}
        />
      </div>
      <div>
        <label htmlFor="confirm-new-password">Nhập lại mật khẩu mới</label>
        <input
          id="confirm-new-password"
          name="password_confirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
          disabled={busy}
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="member-success" role="status">
          {message}
        </p>
      )}
      <div className="member-form-actions">
        <button className="button" disabled={busy}>
          {busy ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
          <Check size={16} />
        </button>
      </div>
    </form>
  );
}
