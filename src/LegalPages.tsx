import { Link } from "react-router-dom";
import { ArrowLeft, Facebook } from "lucide-react";
import { DiscordIcon } from "./AuthProviders";
import "./legal.css";

const terms = [
  [
    "Tài khoản và sử dụng dịch vụ",
    "KEYNEST cung cấp game key, gift card, gói nạp game và công cụ số. Bạn cần cung cấp thông tin chính xác, bảo vệ thông tin đăng nhập và chỉ sử dụng dịch vụ cho mục đích hợp pháp. Không sử dụng sản phẩm để xâm nhập trái phép, lừa đảo, phát tán mã độc hoặc gây hại cho hệ thống khác.",
  ],
  [
    "Thông tin sản phẩm",
    "Kiểm tra nền tảng, khu vực kích hoạt, mệnh giá, thời hạn và hướng dẫn của từng gói trước khi mua. Với sản phẩm nạp game, bạn chịu trách nhiệm kiểm tra mã người chơi và máy chủ đã nhập. Điều kiện sử dụng của nhà phát hành vẫn áp dụng.",
  ],
  [
    "Đặt hàng và thanh toán",
    "Giá và ưu đãi áp dụng được hiển thị trước khi xác nhận đơn. Bạn có thể thanh toán bằng số dư ví hoặc chuyển khoản ngân hàng khi phương thức đó khả dụng. Khi chuyển khoản, hãy giữ nguyên nội dung và số tiền được hướng dẫn; giao dịch không khớp cần được kiểm tra qua trung tâm hỗ trợ.",
  ],
  [
    "Giao sản phẩm",
    "Theo dõi trạng thái và thông tin giao hàng trong mục Đơn hàng. Thời gian xử lý phụ thuộc sản phẩm và tình trạng thanh toán. Không chia sẻ key hoặc thông tin tài khoản được giao. Nếu đơn chưa giao hoặc có sai lệch, gửi yêu cầu gắn với đơn hàng để được kiểm tra.",
  ],
  [
    "Bảo hành và hoàn tiền",
    "Thời hạn bảo hành áp dụng theo gói và thông tin được lưu trong đơn hàng. Gửi mô tả lỗi và bằng chứng trong chi tiết đơn hàng để yêu cầu bảo hành. Yêu cầu hoàn tiền cần được xét duyệt; tạo yêu cầu không đồng nghĩa đã được hoàn tiền. Kết quả và phương thức hoàn tiền được ghi nhận trong quá trình xử lý.",
  ],
  [
    "Ví và mã giảm giá",
    "Ví KEYNEST dùng để mua hàng trên website. Các giới hạn về thời gian, sản phẩm, giá trị đơn và số lượt dùng của mã giảm giá được kiểm tra khi áp dụng. Nếu số dư hoặc lịch sử giao dịch có sai lệch, liên hệ hỗ trợ kèm mã giao dịch.",
  ],
  [
    "Hỗ trợ và cập nhật",
    "Bạn có thể gửi yêu cầu và theo dõi phản hồi tại Trung tâm hỗ trợ. Trang này mô tả quy tắc sử dụng của phiên bản đồ án hiện tại; các thay đổi về điều kiện mua hàng cần được thể hiện trước khi bạn xác nhận giao dịch.",
  ],
];
const privacy = [
  [
    "Thông tin được xử lý",
    "Website xử lý thông tin tài khoản như email, tên và ảnh đại diện; thông tin đơn hàng, giao dịch ví, yêu cầu hỗ trợ và dữ liệu bạn gửi kèm. Hệ thống ghi nhận thông tin trình duyệt và phiên đăng nhập để quản lý truy cập, đồng thời sử dụng địa chỉ IP cho giới hạn yêu cầu.",
  ],
  [
    "Mục đích sử dụng",
    "Thông tin được dùng để đăng nhập, giao sản phẩm, đối soát thanh toán, xử lý bảo hành, phản hồi hỗ trợ và bảo vệ tài khoản. Khi gửi bằng chứng hỗ trợ, hãy che thông tin không liên quan; không gửi mật khẩu, cookie phiên hoặc khóa xác thực hai bước.",
  ],
  [
    "Google, Discord và ảnh đại diện",
    "Nếu bạn chọn đăng nhập bằng Google hoặc Discord, website nhận thông tin hồ sơ do nhà cung cấp trả về qua Supabase Auth. Ảnh đại diện có thể được lấy từ nhà cung cấp. Ảnh tự tải lên được lưu dưới dạng tệp và hồ sơ lưu đường dẫn; người biết đường dẫn ảnh có thể xem ảnh đó.",
  ],
  [
    "Cookie và bộ nhớ trình duyệt",
    "Cookie phiên dùng để duy trì đăng nhập và được đặt HttpOnly. Trình duyệt còn lưu giỏ hàng trong localStorage. Bạn có thể xóa dữ liệu website trong trình duyệt; thao tác này có thể làm mất giỏ hàng cục bộ và yêu cầu đăng nhập lại.",
  ],
  [
    "Dịch vụ tham gia xử lý",
    "Supabase được dùng cho xác thực, cơ sở dữ liệu và lưu trữ tệp khi website chạy ở chế độ Supabase. Nhà cung cấp đăng nhập và dịch vụ thanh toán được cấu hình tham gia xử lý phần dữ liệu cần cho chức năng tương ứng. Các dịch vụ bên ngoài có chính sách riêng; hãy đọc trước khi sử dụng.",
  ],
  [
    "Bảo vệ và quản lý dữ liệu",
    "Bạn có thể cập nhật tên, ảnh đại diện, bật xác thực hai bước và thu hồi các phiên khác trong tài khoản. Dữ liệu đơn hàng, giao dịch và hỗ trợ có thể cần được giữ để xử lý nghiệp vụ. Website chưa cung cấp công cụ tự xóa toàn bộ tài khoản; hãy gửi yêu cầu hỗ trợ để được xem xét.",
  ],
  [
    "Liên hệ về quyền riêng tư",
    "Gửi yêu cầu tại Trung tâm hỗ trợ nếu muốn hỏi về thông tin đã lưu, chỉnh sửa dữ liệu hoặc yêu cầu xóa. Không gửi dữ liệu nhạy cảm qua các kênh công khai. Trang này mô tả cách xử lý dữ liệu của phiên bản đồ án hiện tại.",
  ],
];
export function LegalPage({
  privacy: isPrivacy = false,
}: {
  privacy?: boolean;
}) {
  const sections = isPrivacy ? privacy : terms;
  return (
    <main className="container legal-page">
      <Link className="legal-back" to="/">
        <ArrowLeft size={15} />
        Trang chủ
      </Link>
      <header>
        <span className="eyebrow">KEYNEST / THÔNG TIN DỊCH VỤ</span>
        <h1>{isPrivacy ? "Chính sách bảo mật" : "Điều khoản dịch vụ"}</h1>
        <p>
          {isPrivacy
            ? "Thông tin chúng tôi xử lý và cách bạn quản lý dữ liệu của mình."
            : "Những điều cần biết khi sử dụng tài khoản và mua sản phẩm tại KEYNEST."}
        </p>
      </header>
      <div className="legal-layout">
        <nav aria-label="Mục lục">
          {sections.map(([title], i) => (
            <a key={title} href={`#policy-${i}`}>
              {String(i + 1).padStart(2, "0")} · {title}
            </a>
          ))}
          <Link to={isPrivacy ? "/terms" : "/privacy"}>
            {isPrivacy ? "Điều khoản dịch vụ" : "Chính sách bảo mật"} →
          </Link>
        </nav>
        <article>
          {sections.map(([title, text], i) => (
            <section id={`policy-${i}`} key={title}>
              <h2>
                {i + 1}. {title}
              </h2>
              <p>{text}</p>
            </section>
          ))}
          <Link className="button button-outline" to="/support">
            Liên hệ hỗ trợ
          </Link>
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
