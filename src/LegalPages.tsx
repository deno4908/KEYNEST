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
    "Sản phẩm được giao trực tuyến và có thể theo dõi trong mục Đơn hàng. Với sản phẩm dạng mã hoặc tài khoản, thông tin nhận hàng xuất hiện trong chi tiết đơn khi được giao. Dịch vụ nạp game được thực hiện theo thông tin người chơi đã cung cấp, không giao key. Thời gian xử lý phụ thuộc từng gói và trạng thái thanh toán; không phải mọi đơn đều được giao ngay. Nếu đơn chưa giao hoặc có sai lệch, gửi yêu cầu gắn với đơn hàng để được kiểm tra. Không công khai mã hoặc thông tin tài khoản được giao.",
  ],
  [
    "Bảo hành và hoàn tiền",
    "Thời hạn bảo hành áp dụng theo từng gói và thông tin được lưu trong đơn hàng. Khi sản phẩm gặp lỗi, hãy gửi yêu cầu trong chi tiết đơn, kèm mô tả và bằng chứng đã che thông tin nhạy cảm. KEYNEST kiểm tra tình trạng giao hàng, lỗi sản phẩm và điều kiện của gói để thông báo phương án xử lý. Việc gửi yêu cầu không đồng nghĩa yêu cầu đã được duyệt. Khoản hoàn tiền được xử lý qua chức năng hoàn tiền của website sẽ được ghi có vào số dư ví KEYNEST và thể hiện trong lịch sử giao dịch; nếu cần phương án khác, hãy trao đổi với hỗ trợ trước khi xác nhận. Điều kiện bảo hành không loại trừ quyền của khách hàng theo pháp luật áp dụng.",
  ],
  [
    "Ví và mã giảm giá",
    "Số dư ví KEYNEST là số dư tài khoản mua hàng trên website, không phải tài khoản ngân hàng. Kiểm tra số tiền trước khi nạp và theo dõi kết quả trong lịch sử giao dịch. Các giới hạn về thời gian, sản phẩm, giá trị đơn và số lượt dùng của mã giảm giá được kiểm tra khi áp dụng. Nếu số dư hoặc lịch sử giao dịch có sai lệch, liên hệ hỗ trợ kèm mã giao dịch; không chuyển thêm tiền để thử lại khi giao dịch cũ đang được đối soát.",
  ],
  [
    "Hỗ trợ và giải quyết khiếu nại",
    "Gửi yêu cầu tại Trung tâm hỗ trợ kèm mã đơn hoặc mã giao dịch, mô tả vấn đề và kết quả bạn mong muốn. Bạn có thể theo dõi phản hồi ngay trong tài khoản. KEYNEST sẽ kiểm tra thông tin và trao đổi phương án xử lý qua yêu cầu đó. Nếu chưa thống nhất được kết quả, bạn có thể tiếp tục phản hồi hoặc sử dụng các phương thức giải quyết tranh chấp theo pháp luật Việt Nam.",
  ],
  [
    "Cập nhật điều khoản",
    "Điều khoản và điều kiện của từng gói được công bố để bạn xem trước khi xác nhận mua hàng. Các thay đổi được cập nhật tại trang này cùng ngày cập nhật; thay đổi không tự động làm mất quyền lợi đã được xác nhận cho đơn hàng trước đó. Nếu có nội dung chưa rõ, hãy liên hệ hỗ trợ trước khi thanh toán.",
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
    "Website sử dụng cookie xác thực có thuộc tính HttpOnly để duy trì và làm mới phiên đăng nhập. Token truy cập có thể được giữ trong bộ nhớ ứng dụng để xác thực yêu cầu đến máy chủ. Trình duyệt còn lưu giỏ hàng và trạng thái giao diện trong bộ nhớ cục bộ hoặc bộ nhớ phiên. Bạn có thể xóa dữ liệu website trong trình duyệt; thao tác này có thể làm mất giỏ hàng cục bộ và yêu cầu đăng nhập lại.",
  ],
  [
    "Dịch vụ tham gia xử lý",
    "KEYNEST sử dụng Supabase cho xác thực, cơ sở dữ liệu và lưu trữ tệp; Google hoặc Discord khi bạn chọn đăng nhập qua các dịch vụ này; Pay2S và ngân hàng cho đối soát chuyển khoản. Cloudflare tham gia bảo vệ và phân phối truy cập website; Google reCAPTCHA được dùng ở các biểu mẫu có bật xác minh chống spam. Khi trình duyệt tải ảnh từ Steam hoặc nhà cung cấp ảnh đại diện, nhà cung cấp đó nhận thông tin kết nối cần thiết như địa chỉ IP. Tùy dịch vụ, dữ liệu có thể được xử lý trên máy chủ ngoài Việt Nam. Mỗi nhà cung cấp có chính sách quyền riêng tư riêng.",
  ],
  [
    "Bảo vệ và quản lý dữ liệu",
    "Bạn có thể cập nhật tên, ảnh đại diện, bật xác thực hai bước và thu hồi các phiên khác trong tài khoản. Dữ liệu được lưu phục vụ hoạt động tài khoản, thực hiện đơn hàng, đối soát, bảo hành, giải quyết khiếu nại và nghĩa vụ lưu trữ áp dụng. Việc xóa tài khoản không đồng nghĩa mọi chứng từ giao dịch có thể được xóa ngay. Khi nhận yêu cầu xóa, KEYNEST sẽ kiểm tra dữ liệu liên quan và thông báo phạm vi có thể xử lý, cùng lý do nếu cần tiếp tục lưu giữ.",
  ],
  [
    "Liên hệ về quyền riêng tư",
    "Bạn có thể gửi yêu cầu tại Trung tâm hỗ trợ để hỏi về dữ liệu đã lưu, yêu cầu truy cập, chỉnh sửa, xóa hoặc hạn chế xử lý thông tin cá nhân. KEYNEST có thể yêu cầu xác minh chủ tài khoản trước khi xử lý để tránh cung cấp dữ liệu cho người khác. Việc hạn chế dữ liệu cần thiết có thể ảnh hưởng đến khả năng đăng nhập, giao hàng hoặc hỗ trợ; tác động cụ thể sẽ được trao đổi khi xử lý yêu cầu. Không gửi mật khẩu hoặc mã xác thực qua yêu cầu hỗ trợ.",
  ],
  [
    "Cập nhật chính sách",
    "Các thay đổi về cách xử lý dữ liệu được cập nhật tại trang này cùng ngày cập nhật. Hãy xem lại chính sách khi sử dụng tính năng mới hoặc cung cấp thêm thông tin cho cửa hàng. Bạn có thể hỏi về nội dung chính sách qua Trung tâm hỗ trợ.",
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
        <p>Cập nhật ngày <time dateTime="2026-10-11">11/10/2026</time> · Áp dụng tại keynest.store</p>
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
