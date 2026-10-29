import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, MessageSquare, Star, Trash2 } from "lucide-react";
import { useStore } from "./App";
import { api, date, post } from "./api";
import { Avatar } from "./Avatar";
import type { Product, ProductComment, Review } from "./types";

export function RatingStars({ value }: { value: number }) {
  return (
    <span
      className="rating-stars"
      role="img"
      aria-label={`${value.toLocaleString("vi-VN")} trên 5 sao`}
    >
      <Star size={12} aria-hidden="true" />
      <span>
        {value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}/5
      </span>
    </span>
  );
}
export function RatingLine({ product }: { product: Product }) {
  const count = product.review_count || 0;
  return (
    <span className="product-rating-line">
      {count ? (
        <>
          <RatingStars value={product.rating_average || 0} />
          <span className="rating-separator" aria-hidden="true">
            ·
          </span>
          <span>{count} đánh giá</span>
        </>
      ) : (
        <span>Chưa có đánh giá</span>
      )}
    </span>
  );
}
export function ProductFeedback({
  product,
  mode,
}: {
  product: Product;
  mode: "reviews" | "comments";
}) {
  const { user, login, refresh, notify } = useStore();
  const reviewsMode = mode === "reviews";
  const [reviews, setReviews] = useState<Review[]>([]);
  const [comments, setComments] = useState<ProductComment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState("");
  const [body, setBody] = useState("");
  const [rating, setRating] = useState(5);
  const [formError, setFormError] = useState("");
  const [sent, setSent] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const request = reviewsMode
      ? api<Review[]>(`/products/${product.id}/reviews`).then((rows) => {
          if (active) setReviews(rows);
        })
      : api<{ items: ProductComment[]; total: number }>(
          `/products/${product.id}/comments`,
        ).then((data) => {
          if (active) {
            setComments(data.items);
            setTotal(data.total);
          }
        });
    request
      .then(() => {
        if (active) setPage(1);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [product.id, reviewsMode, retry]);
  async function more() {
    setLoading(true);
    setError("");
    try {
      if (reviewsMode) {
        const rows = await api<Review[]>(
          `/products/${product.id}/reviews?page=${page + 1}`,
        );
        setReviews((old) => [
          ...old,
          ...rows.filter((r) => !old.some((x) => x.id === r.id)),
        ]);
      } else {
        const data = await api<{ items: ProductComment[]; total: number }>(
          `/products/${product.id}/comments?page=${page + 1}`,
        );
        setComments((old) => [
          ...old,
          ...data.items.filter((r) => !old.some((x) => x.id === r.id)),
        ]);
        setTotal(data.total);
      }
      setPage((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (reviewsMode) {
        const row = await post<Review>("/reviews", {
          product_id: product.id,
          rating,
          comment: body.trim(),
        });
        setReviews((old) => [row, ...old]);
        setSent(true);
        refresh().catch(() =>
          notify(
            "Đã lưu đánh giá. Tải lại trang để cập nhật điểm tổng hợp.",
            true,
          ),
        );
      } else {
        const row = await post<ProductComment>("/comments", {
          product_id: product.id,
          body: body.trim(),
        });
        setComments((old) => [row, ...old]);
        setTotal((n) => n + 1);
      }
      setBody("");
      notify(reviewsMode ? "Đã gửi đánh giá." : "Đã gửi bình luận.");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setDeleting(id);
    setFormError("");
    try {
      await post(`/comments/${id}/delete`);
      // Reload the first page so deleting a row cannot skip the next page's first item.
      setRetry((n) => n + 1);
      notify("Đã xóa bình luận.");
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setDeleting("");
    }
  }
  const ownReview =
    reviewsMode && (sent || reviews.some((r) => r.user_id === user?.id));
  const count = product.review_count || 0;
  const rows = reviewsMode ? reviews : comments;
  return (
    <section
      className="product-feedback"
      aria-label={reviewsMode ? "Đánh giá sản phẩm" : "Bình luận sản phẩm"}
    >
      {reviewsMode ? (
        <div className="rating-overview">
          <RatingLine product={product} />
          <details className="rating-breakdown">
            <summary>Chi tiết số sao</summary>
            <div className="rating-distribution">
              {[5, 4, 3, 2, 1].map((n) => {
                const value = product.rating_counts?.[n - 1] || 0;
                return (
                  <div key={n}>
                    <span>
                      {n} <Star size={12} aria-hidden="true" />
                    </span>
                    <span
                      className="rating-track"
                      role="img"
                      aria-label={`${n} sao: ${value} đánh giá`}
                    >
                      <span
                        style={{
                          width: `${count ? (value / count) * 100 : 0}%`,
                        }}
                      />
                    </span>
                    <small>{value}</small>
                  </div>
                );
              })}
            </div>
          </details>
          <button
            className="button button-outline"
            onClick={() => (user ? textarea.current?.focus() : login())}
            disabled={!!ownReview}
          >
            {ownReview ? "Bạn đã đánh giá" : "Viết đánh giá"}
          </button>
        </div>
      ) : (
        <div className="comments-heading">
          <MessageSquare size={24} />
          <div>
            <h2>
              Bình luận & hỏi đáp <span>({total})</span>
            </h2>
            <p>Trao đổi về sản phẩm, phiên bản và cách sử dụng.</p>
          </div>
        </div>
      )}
      <div className="feedback-layout">
        <div className="feedback-list" aria-busy={loading}>
          <h3>
            {reviewsMode ? "Đánh giá từ người mua" : "Bình luận mới nhất"}
          </h3>
          {error && (
            <div className="feedback-error" role="alert">
              <p>{error}</p>
              <button
                className="text-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                Thử lại
              </button>
            </div>
          )}
          {!loading && !error && !rows.length && (
            <div className="feedback-empty">
              <MessageSquare size={28} />
              <p>
                {reviewsMode
                  ? "Chưa có đánh giá cho sản phẩm này."
                  : "Chưa có bình luận. Hãy bắt đầu cuộc trao đổi."}
              </p>
            </div>
          )}
          {rows.map((row) => (
            <article className="feedback-entry" key={row.id}>
              <div className="feedback-author">
                <Avatar
                  className="feedback-avatar"
                  name={row.name || "Khách hàng"}
                  url={row.avatar_url}
                />
                <div>
                  <strong>{row.name || "Khách hàng"}</strong>
                  <time dateTime={row.created_at}>{date(row.created_at)}</time>
                </div>
                {"rating" in row ? (
                  <span className="verified-buyer">
                    <CheckCircle2 size={13} />
                    Đã mua hàng
                  </span>
                ) : (
                  user &&
                  (user.id === row.user_id || user.role === "admin") && (
                    <button
                      className="icon-button"
                      aria-label={`Xóa bình luận của ${row.name || "Khách hàng"}`}
                      disabled={!!deleting || loading}
                      onClick={() => remove(row.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )
                )}
              </div>
              {"rating" in row && <RatingStars value={row.rating} />}
              <p className="feedback-body">
                {"comment" in row ? row.comment : row.body}
              </p>
            </article>
          ))}
          {loading && (
            <p className="muted" role="status">
              Đang tải…
            </p>
          )}
          {!error && rows.length < (reviewsMode ? count : total) && (
            <button
              className="button button-outline feedback-more"
              disabled={loading}
              onClick={more}
            >
              Xem thêm {reviewsMode ? "đánh giá" : "bình luận"}
            </button>
          )}
        </div>
        <aside className="feedback-compose">
          <h3>{reviewsMode ? "Đánh giá sản phẩm" : "Viết bình luận"}</h3>
          {reviewsMode && (
            <p className="feedback-guideline">
              Dành cho khách đã mua và nhận sản phẩm. Mỗi tài khoản đánh giá một
              lần.
            </p>
          )}
          {!user ? (
            <>
              <p>
                Đăng nhập để{" "}
                {reviewsMode
                  ? "chia sẻ trải nghiệm sau khi nhận sản phẩm"
                  : "bình luận hoặc đặt câu hỏi về sản phẩm"}
                .
              </p>
              <button className="button full" onClick={login}>
                Đăng nhập
              </button>
            </>
          ) : ownReview ? (
            <p className="feedback-thanks">
              <CheckCircle2 size={18} />
              Cảm ơn bạn đã chia sẻ trải nghiệm.
            </p>
          ) : (
            <form onSubmit={submit}>
              {reviewsMode && (
                <fieldset className="rating-picker" disabled={busy}>
                  <legend>Số sao của bạn</legend>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n}>
                      <input
                        type="radio"
                        name="rating"
                        value={n}
                        checked={rating === n}
                        onChange={() => setRating(n)}
                        aria-label={`${n} sao`}
                      />
                      <Star
                        size={26}
                        aria-hidden="true"
                        className={n <= rating ? "filled" : ""}
                      />
                    </label>
                  ))}
                </fieldset>
              )}
              <label htmlFor={`feedback-${mode}`}>
                {reviewsMode ? "Trải nghiệm của bạn" : "Nội dung bình luận"}
              </label>
              <textarea
                ref={textarea}
                id={`feedback-${mode}`}
                required
                minLength={3}
                maxLength={1000}
                rows={5}
                value={body}
                disabled={busy}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  reviewsMode
                    ? "Sản phẩm và quá trình nhận hàng thế nào?"
                    : "Bạn muốn hỏi hoặc chia sẻ điều gì?"
                }
              />
              <small className="feedback-counter">
                {body.length}/1.000 ký tự
              </small>
              <p className="feedback-guideline">
                Không chia sẻ key, mật khẩu hoặc thông tin thanh toán tại đây.
              </p>
              <button className="button full" disabled={busy || loading}>
                {busy
                  ? "Đang gửi…"
                  : reviewsMode
                    ? "Gửi đánh giá"
                    : "Gửi bình luận"}
              </button>
            </form>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
