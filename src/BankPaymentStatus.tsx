import { useEffect, useState } from "react";
import { api, date } from "./api";

type BankStatus = {
  provider: string;
  configured: boolean;
  ready: boolean;
  reason: string | null;
  webhook_path: string;
  last_received_at: string | null;
  infrastructure?: {
    kafka_enabled: boolean;
    redis_enabled: boolean;
    redis_ready: boolean;
    payment_processing: string;
  };
};
const reasons: Record<string, string> = {
  demo: "Đang chạy mô phỏng, không nhận tiền thật.",
  bank_details_missing: "Chưa cấu hình đủ thông tin tài khoản ngân hàng.",
  webhook_key_missing: "Chưa cấu hình token webhook ở server.",
};
export function BankPaymentStatus() {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      api<BankStatus>("/admin/bank-payments/status", {
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) {
            setStatus(value);
            setError("");
          }
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  return (
    <section className="panel" aria-label="Kết nối ngân hàng">
      <h3>
        {status?.provider === "pay2s"
          ? "Pay2S · Chuyển khoản ngân hàng"
          : "Kết nối ngân hàng"}
      </h3>
      <p className="muted" role="status">
        {!status
          ? "Đang kiểm tra cấu hình…"
          : status.ready
            ? "Đã cấu hình tiếp nhận webhook"
            : reasons[status.reason || ""] || "Chưa sẵn sàng"}
      </p>
      {status && (
        <p className="muted">
          Đường dẫn webhook: <code>{status.webhook_path}</code>
        </p>
      )}
      {status?.infrastructure && (
        <p className="muted">
          Xử lý thanh toán:{" "}
          {status.infrastructure.kafka_enabled ? "Kafka + worker" : "trực tiếp"}
          . Giới hạn truy cập:{" "}
          {status.infrastructure.redis_enabled
            ? status.infrastructure.redis_ready
              ? "Redis"
              : "Redis mất kết nối"
            : "trong tiến trình"}
          .
          {status.infrastructure.kafka_enabled &&
            " Webhook được tiếp nhận không đồng nghĩa worker đã thanh toán xong. Kiểm tra consumer lag khi có chậm trễ."}
        </p>
      )}
      {status?.last_received_at ? (
        <p className="muted">
          Webhook hợp lệ gần nhất trong phiên chạy này:{" "}
          {date(status.last_received_at)}
        </p>
      ) : (
        status?.ready && (
          <p className="muted">
            Chưa nhận webhook trong phiên chạy này. Kiểm tra giao dịch thử và
            lịch sử gửi trên Pay2S.
          </p>
        )
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
