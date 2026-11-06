import { Globe2, MapPin, RefreshCw } from 'lucide-react';
import './region.css';

export function RegionRestricted() {
  return <div className="region-screen">
    <header><a href="/" className="region-brand"><span>//</span> KEYNEST</a><span>Cửa hàng sản phẩm số</span></header>
    <main><section className="region-card" aria-labelledby="region-title">
      <div className="region-visual" aria-hidden="true"><Globe2 size={190} strokeWidth={.6} /><div className="region-country"><svg viewBox="0 0 60 40" width="60" height="40"><path fill="#ba3034" d="M0 0h60v40H0z"/><path fill="#ffdb70" d="m30 8 2.8 8.6h9l-7.3 5.3 2.8 8.6-7.3-5.3-7.3 5.3 2.8-8.6-7.3-5.3h9z"/></svg><strong>VIỆT NAM</strong></div></div>
      <div className="region-content"><span className="region-caption"><MapPin size={15} />Khu vực phục vụ</span><h1 id="region-title">KEYNEST hiện chỉ hoạt động tại Việt Nam.</h1><p>Kết nối hiện tại nằm ngoài khu vực phục vụ hoặc chưa xác định được vị trí IP.</p><div className="region-help"><strong>Bạn vẫn đang ở Việt Nam?</strong><p>Hãy tắt VPN / proxy nước ngoài hoặc chuyển sang mạng Wi-Fi, 4G / 5G tại Việt Nam, rồi thử truy cập lại.</p></div><a href="/" className="button"><RefreshCw size={16} />Thử truy cập lại</a></div>
    </section><p className="region-note">Khu vực được xác định theo IP, không sử dụng vị trí GPS.</p></main>
    <footer><a href="/terms">Điều khoản dịch vụ</a><a href="/privacy">Chính sách bảo mật</a></footer>
  </div>;
}
