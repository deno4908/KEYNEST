import { ImageUpload } from "./ImageUpload";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Eye,
  Image as ImageIcon,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { api, post } from "./api";
import { useDataRefresh } from './useDataRefresh';
import { Modal, useStore } from "./App";
import type { Banner } from "./types";

export function BannerSlider() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  useDataRefresh(async () => {
    try { setBanners(await api<Banner[]>("/banners")); setIndex(0); }
    catch { /* Keep the current banner on a temporary connection failure. */ }
  }, ['/admin/banners']);
  useEffect(() => {
    const controller = new AbortController();
    api<Banner[]>("/banners", { signal: controller.signal })
      .then(setBanners)
      .catch(() => {});
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPaused(media.matches);
    sync();
    media.addEventListener("change", sync);
    const visibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      controller.abort();
      media.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (banners.length < 2 || paused || focused || hidden)
      return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % banners.length),
      8000,
    );
    return () => clearInterval(timer);
  }, [banners.length, paused, focused, hidden, index]);
  useEffect(() => {
    if (banners.length < 2) return;
    const nextImage = new window.Image();
    nextImage.src = banners[(index + 1) % banners.length].image;
  }, [banners, index]);
  if (!banners.length)
    return (
      <div className="banner-fallback">
        <span>KEYNEST / DIGITAL STORE</span>
        <h2>
          Tìm game hay.
          <br />
          Chọn dịch vụ phù hợp.
        </h2>
        <Link className="button" to="/catalog">
          Khám phá cửa hàng
          <ArrowRight size={17} />
        </Link>
      </div>
    );
  const active = banners[index % banners.length];
  function move(next: number) {
    setIndex((next + banners.length) % banners.length);
  }
  return (
    <section
      className="campaign-slider"
      aria-label="Banner nổi bật"
      aria-roledescription="carousel"
      onPointerDown={() => setFocused(false)}
      onFocusCapture={(e) => setFocused(e.target.matches(":focus-visible"))}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") setFocused(true);
        if (e.key === "ArrowRight") {
          e.preventDefault();
          move(index + 1);
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          move(index - 1);
        }
      }}
    >
      <div
        className="campaign-slide"
        key={active.id}
        role="group"
        aria-roledescription="slide"
        aria-label={`${index + 1} / ${banners.length}`}
      >
        <img
          className="campaign-image"
          src={active.image}
          alt=""
          fetchPriority="high"
        />
        <div className="campaign-shade" />
        <div className="campaign-copy">
          <span>{active.eyebrow}</span>
          <h2>{active.title}</h2>
          <p>{active.description}</p>
          <Link className="button" to={active.href}>
            {active.cta}
            <ArrowRight size={17} />
          </Link>
        </div>
      </div>
      {banners.length > 1 && (
        <div className="campaign-controls">
          <div className="campaign-dots">
            {banners.map((b, i) => (
              <button
                key={b.id}
                aria-label={`Xem banner ${i + 1}: ${b.title}`}
                aria-pressed={index === i}
                onClick={() => move(i)}
              >
                <span />
              </button>
            ))}
          </div>
          <span className="campaign-count">
            {String(index + 1).padStart(2, "0")} /{" "}
            {String(banners.length).padStart(2, "0")}
          </span>
          <button
            aria-label={
              paused ? "Tiếp tục chuyển banner" : "Tạm dừng chuyển banner"
            }
            onClick={() => {
              setPaused(!paused);
              setFocused(false);
            }}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button aria-label="Banner trước" onClick={() => move(index - 1)}>
            <ChevronLeft size={18} />
          </button>
          <button aria-label="Banner tiếp theo" onClick={() => move(index + 1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </section>
  );
}

const emptyBanner = {
  title: "",
  eyebrow: "",
  description: "",
  image: "",
  href: "/catalog",
  cta: "Khám phá ngay",
  active: false,
  sort_order: 0,
};
export function BannerManager() {
  const { notify } = useStore();
  const [banners, setBanners] = useState<Banner[]>([]);
  const [editing, setEditing] = useState<Partial<Banner> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const load = () =>
    api<Banner[]>("/admin/banners")
      .then(setBanners)
      .catch((e) => setError(e.message));
  useDataRefresh(load, ['/admin/banners']);
  useEffect(() => {
    load();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      await post("/admin/banners", {
        ...(editing!.id ? { id: editing!.id } : {}),
        title: f.get("title"),
        eyebrow: f.get("eyebrow"),
        description: f.get("description"),
        image: f.get("image"),
        href: f.get("href"),
        cta: f.get("cta"),
        active: f.get("active") === "on",
        sort_order: Number(f.get("sort_order")),
      });
      setEditing(null);
      await load();
      notify("Đã lưu banner trang chủ.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="banner-manager">
      <div className="section-title">
        <div>
          <h2>Banner trang chủ</h2>
          <p className="muted">
            Sắp xếp, chỉnh nội dung và bật/tắt các slide trong cửa hàng.
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setError("");
            setEditing({ ...emptyBanner, sort_order: banners.length });
          }}
        >
          <Plus size={17} />
          Thêm banner
        </button>
      </div>
      {error && !editing && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="banner-admin-list">
        {banners.map((b) => (
          <article key={b.id}>
            <img src={b.image} alt="" />
            <div>
              <small>
                #{b.sort_order} · {b.active ? "Đang hiển thị" : "Đang ẩn"}
              </small>
              <h3>{b.title}</h3>
              <p>{b.href}</p>
            </div>
            <button
              className="button button-outline"
              onClick={() => {
                setError("");
                setEditing(b);
              }}
            >
              <Pencil size={15} />
              Chỉnh sửa
            </button>
            <button className="button button-outline admin-delete-button" aria-label={`Xóa banner ${b.title}`} disabled={busy} onClick={async () => {
              if (!window.confirm(`Xóa banner “${b.title}”? Thao tác này không thể hoàn tác.`)) return;
              setBusy(true); setError("");
              try {
                await api(`/admin/banners/${b.id}`, { method: "DELETE" });
                setBanners(rows => rows.filter(row => row.id !== b.id));
                notify("Đã xóa banner.");
              } catch (e) { setError((e as Error).message); }
              finally { setBusy(false); }
            }}><Trash2 size={15} />Xóa</button>
          </article>
        ))}
        {!banners.length && <p className="muted">Chưa có banner. Thêm banner để hiển thị trên trang chủ.</p>}
      </div>
      <Link className="text-button" to="/">
        <Eye size={15} />
        Xem trang chủ
      </Link>
      {editing && (
        <Modal
          title={editing.id ? "Chỉnh sửa banner" : "Thêm banner"}
          close={() => setEditing(null)}
          wide
        >
          <form className="form" onSubmit={save}>
            <div className="form-grid">
              <label>
                Tiêu đề banner
                <input
                  name="title"
                  defaultValue={editing.title}
                  required
                  minLength={2}
                  maxLength={100}
                />
              </label>
              <label>
                Nhãn phía trên
                <input
                  name="eyebrow"
                  defaultValue={editing.eyebrow}
                  maxLength={60}
                />
              </label>
            </div>
            <label>
              Mô tả banner
              <textarea
                name="description"
                defaultValue={editing.description}
                maxLength={240}
              />
            </label>
            <ImageUpload
              initial={editing.image}
              label="Ảnh banner"
              required
              onBusy={setUploading}
            />
            <label>
              Liên kết trong cửa hàng
              <input
                name="href"
                defaultValue={editing.href}
                required
                maxLength={300}
                placeholder="/catalog?category=game"
              />
            </label>
            <div className="form-grid">
              <label>
                Chữ trên nút
                <input
                  name="cta"
                  defaultValue={editing.cta}
                  required
                  minLength={2}
                  maxLength={40}
                />
              </label>
              <label>
                Thứ tự hiển thị
                <input
                  name="sort_order"
                  type="number"
                  min={0}
                  max={999}
                  defaultValue={editing.sort_order}
                  required
                />
              </label>
            </div>
            <label className="checkbox">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editing.active}
              />
              Hiển thị trên trang chủ
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button" disabled={busy || uploading}>
              <ImageIcon size={17} />
              {busy ? "Đang lưu…" : "Lưu banner"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
