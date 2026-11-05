import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Facebook, ShieldCheck, FileText, List, ChevronDown, Headphones } from "lucide-react";
import { DiscordIcon } from "./AuthProviders";
import "./legal.css";

import { terms, privacy, LEGAL_VERSION, LEGAL_UPDATED_AT, LEGAL_UPDATED_LABEL, legalSources } from "../shared/legal-content.js";

export function LegalPage({
  privacy: isPrivacy = false,
}: {
  privacy?: boolean;
}) {
  const sections = isPrivacy ? privacy : terms;
  const contents = sections.map(([title], i) => (
    <a key={title} href={`#policy-${i}`}><span>{String(i + 1).padStart(2, "0")}</span>{title}</a>
  ));
  return (
    <main className="container legal-page">
      <Link className="legal-back" to="/">
        <ArrowLeft size={15} />
        Trang chủ
      </Link>
      <header className="legal-hero">
        <h1>{isPrivacy ? "Chính sách bảo mật" : "Điều khoản dịch vụ"}</h1>
        <p>
          {isPrivacy
            ? "Thông tin chúng tôi xử lý và cách bạn quản lý dữ liệu của mình."
            : "Những điều cần biết khi sử dụng tài khoản và mua sản phẩm tại KEYNEST."}
        </p>
        <p className="legal-meta">Cập nhật lần cuối: <time dateTime={LEGAL_UPDATED_AT}>{LEGAL_UPDATED_LABEL}</time> · Phiên bản {LEGAL_VERSION}</p>
        <button className="text-button legal-print" onClick={() => window.print()}>In / lưu chính sách</button>
      </header>
      <nav className="legal-tabs" aria-label="Chính sách cửa hàng">
        <Link to="/terms" aria-current={!isPrivacy ? 'page' : undefined}><FileText size={17} />Điều khoản dịch vụ</Link>
        <Link to="/privacy" aria-current={isPrivacy ? 'page' : undefined}><ShieldCheck size={17} />Chính sách bảo mật</Link>
      </nav>
      <div className="legal-layout">
        <aside className="legal-sidebar">
          <nav className="legal-toc legal-toc-desktop" aria-label="Mục lục"><strong><List size={16} />Trong trang này</strong>{contents}</nav>
          <details className="legal-toc-mobile"><summary><List size={17} />Mục lục · {sections.length} nội dung<ChevronDown size={16} /></summary><nav className="legal-toc" aria-label="Mục lục trên điện thoại">{contents}</nav></details>
          <div className="legal-help"><Headphones size={22} /><strong>Bạn cần giải đáp?</strong><p>Gửi câu hỏi để được hỗ trợ về đơn hàng hoặc tài khoản.</p><Link to="/support">Liên hệ KEYNEST<ArrowUpRight size={15} /></Link></div>
        </aside>
        <article className="legal-document">
          {sections.map(([title, text], i) => (
            <section className="legal-section" id={`policy-${i}`} key={title}>
              <span className="legal-section-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <div><h2>{title}</h2><p>{text}</p></div>
            </section>
          ))}
          <section className="legal-sources"><h2>Văn bản pháp luật tham khảo</h2>
            <ul>{legalSources.map(([title, url]) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{title}</a></li>)}</ul>
          </section>
          <div className="legal-document-end"><ShieldCheck size={17} /><span>Cảm ơn bạn đã dành thời gian tìm hiểu chính sách của KEYNEST.</span></div>
        </article>
      </div>
    </main>
  );
}
function socialUrl(value: string | undefined, hosts: string[]) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      hosts.includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function SocialLinks() {
  const discord = socialUrl(import.meta.env.VITE_DISCORD_URL, [
    "discord.gg",
    "discord.com",
    "www.discord.com",
  ]);
  const facebook = socialUrl(import.meta.env.VITE_FACEBOOK_URL, [
    "facebook.com",
    "www.facebook.com",
    "m.facebook.com",
    "fb.com",
    "www.fb.com",
  ]);
  return (
    <div className="footer-socials">
      {[
        { name: "Discord", url: discord, icon: <DiscordIcon /> },
        { name: "Facebook", url: facebook, icon: <Facebook size={17} /> },
      ].map((s) =>
        s.url ? (
          <a
            key={s.name}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Liên hệ qua ${s.name} (mở tab mới)`}
          >
            {s.icon}
            {s.name}
          </a>
        ) : (
          <span
            key={s.name}
            aria-disabled="true"
            title={`Chưa cấu hình liên kết ${s.name}`}
          >
            {s.icon}
            {s.name}
          </span>
        ),
      )}
    </div>
  );
}
